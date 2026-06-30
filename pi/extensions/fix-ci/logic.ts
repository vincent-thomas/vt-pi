/**
 * logic.ts — pure helpers for fix-ci (no pi imports).
 *
 * Handles git push, polling GitHub checks, and fetching failure logs via `gh`.
 *
 * All shell commands use async exec to avoid blocking the Node event loop
 * (which freezes the TUI). The abort signal is threaded through so Ctrl+C
 * kills child processes promptly.
 */
import { execAsync, extractErrorOutput } from "../../lib/exec-async.ts";
import { hasUpstream } from "../../lib/git-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckResult {
	name: string;
	state: string; // SUCCESS, FAILURE, PENDING, IN_PROGRESS, SKIPPED, etc.
	bucket: string; // pass, fail, pending, skipping, cancel
	link: string | null;
}

export interface PollResult {
	checks: CheckResult[];
	timedOut: boolean;
	polls: number;
}

export interface PollTarget {
	sha: string;
	mode: string;
}

export interface FailureLog {
	name: string;
	link: string | null;
	runId: string | null;
	log: string | null;
}

export interface PushResult {
	success: boolean;
	output: string;
}

// ---------------------------------------------------------------------------
// Git push
// ---------------------------------------------------------------------------

export async function gitPush(cwd: string, signal?: AbortSignal): Promise<PushResult> {
	// A brand-new branch has no upstream, so a bare `git push` fails. In that
	// case push and set the upstream in one go so first pushes succeed.
	const command = (await hasUpstream(cwd, signal))
		? "git push"
		: "git push -u origin HEAD";

	try {
		const { stdout, stderr } = await execAsync(command, {
			cwd,
			timeout: 60_000,
			signal,
		});
		return { success: true, output: stdout + stderr };
	} catch (err: unknown) {
		return { success: false, output: extractErrorOutput(err) };
	}
}

// ---------------------------------------------------------------------------
// Check mode detection
// ---------------------------------------------------------------------------

export async function detectPrNumber(cwd: string, signal?: AbortSignal): Promise<number | null> {
	try {
		const { stdout } = await execAsync("gh pr view --json number --jq '.number' 2>/dev/null", {
			cwd,
			timeout: 15_000,
			signal,
		});
		const num = parseInt(stdout.trim(), 10);
		return isNaN(num) ? null : num;
	} catch {
		return null;
	}
}

export async function getHeadSha(cwd: string, signal?: AbortSignal): Promise<string | null> {
	try {
		const { stdout } = await execAsync("git rev-parse HEAD", {
			cwd,
			timeout: 5_000,
			signal,
		});
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Returns true if there are unpushed commits (or branch doesn't exist on remote).
 * Compares local HEAD SHA against the remote branch SHA via git ls-remote.
 */
export async function hasUnpushedCommits(
	cwd: string,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const { stdout: branch } = await execAsync(
			"git rev-parse --abbrev-ref HEAD",
			{ cwd, timeout: 5_000, signal },
		);
		const { stdout: localSha } = await execAsync(
			"git rev-parse HEAD",
			{ cwd, timeout: 5_000, signal },
		);
		const { stdout: remoteSha } = await execAsync(
			`git ls-remote origin ${branch.trim()}`,
			{ cwd, timeout: 10_000, signal },
		);

		// ls-remote returns empty if branch doesn't exist on remote yet.
		if (!remoteSha.trim()) return true;

		// Format: "<sha>\trefs/heads/<branch>"
		const remoteHead = remoteSha.split("\t")[0];
		return localSha.trim() !== remoteHead;
	} catch {
		// If anything fails, assume there's something to push.
		return true;
	}
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const MAX_POLLS = 360;
const POLL_INTERVAL_SHORT_MS = 10_000;
const POLL_INTERVAL_LONG_MS = 30_000;
const SHORT_PHASE_POLLS = 12;
const EMPTY_GRACE_POLLS = 4;

function isPending(state: string): boolean {
	return state === "PENDING" || state === "IN_PROGRESS";
}

export function isFailure(bucket: string): boolean {
	return bucket === "fail" || bucket === "cancel";
}

export function mapCheckRun(
	status: string,
	conclusion: string | null,
): { state: string; bucket: string } {
	if (status === "completed") {
		switch (conclusion) {
			case "success":
				return { state: "SUCCESS", bucket: "pass" };
			case "skipped":
			case "neutral":
				return { state: "SKIPPED", bucket: "skipping" };
			case "cancelled":
				return { state: "CANCELLED", bucket: "cancel" };
			default:
				return { state: "FAILURE", bucket: "fail" };
		}
	}
	if (status === "in_progress") return { state: "IN_PROGRESS", bucket: "pending" };
	return { state: "PENDING", bucket: "pending" };
}

export function mapStatusState(state: string): {
	state: string;
	bucket: string;
} {
	switch (state) {
		case "success":
			return { state: "SUCCESS", bucket: "pass" };
		case "pending":
			return { state: "PENDING", bucket: "pending" };
		default:
			return { state: "FAILURE", bucket: "fail" };
	}
}

export function allSuitesComplete(suiteStatuses: string[]): boolean {
	return suiteStatuses.every((s) => s === "completed");
}

export async function resolvePollTarget(
	cwd: string,
	signal?: AbortSignal,
	pushedSha?: string,
): Promise<PollTarget> {
	const sha = pushedSha || (await getHeadSha(cwd, signal)) || "";
	const pr = await detectPrNumber(cwd, signal);
	const mode = pr
		? `PR #${pr} (${sha.slice(0, 8)})`
		: sha
			? `commit ${sha.slice(0, 8)}`
			: "unknown";
	return { sha, mode };
}

export async function pollChecks(
	cwd: string,
	signal?: AbortSignal,
	onStatus?: (msg: string) => void,
	pushedSha?: string,
): Promise<PollResult & { mode: string }> {
	const { sha, mode } = await resolvePollTarget(cwd, signal, pushedSha);

	onStatus?.(`Checking CI for ${mode}…`);

	if (!sha) {
		return { checks: [], timedOut: false, polls: 0, mode };
	}

	let polls = 0;
	let emptyPolls = 0;
	let settlingPolls = 0;
	let allChecksCompletedOnce = false;

	while (polls < MAX_POLLS) {
		if (signal?.aborted) {
			return {
				checks: await getChecksForSha(sha, cwd, signal),
				timedOut: true,
				polls,
				mode,
			};
		}

		polls++;
		const checks = await getChecksForSha(sha, cwd, signal);
		const suites = await getSuiteStatuses(sha, cwd, signal);
		const suitesComplete = allSuitesComplete(suites);

		const pending = checks.filter((c) => isPending(c.state)).length;
		const total = checks.length;

		if (total === 0) {
			if (suitesComplete) emptyPolls++;
			else emptyPolls = 0;

			if (suitesComplete && emptyPolls >= EMPTY_GRACE_POLLS) {
				onStatus?.(`No checks were registered for ${mode}.`);
				return { checks, timedOut: false, polls, mode };
			}
			onStatus?.(`Poll ${polls}: no checks registered yet for ${mode}, waiting…`);
		} else {
			emptyPolls = 0;
			if (pending === 0 && suitesComplete) {
				onStatus?.(`All ${total} checks finished for ${mode}.`);
				return { checks, timedOut: false, polls, mode };
			}
			// Track if we've ever seen all checks complete to avoid API blips resetting progress
			if (pending === 0) {
				allChecksCompletedOnce = true;
			}
			// Once all checks have completed at least once, start settling grace period
			if (allChecksCompletedOnce && !suitesComplete) {
				settlingPolls++;
				if (settlingPolls >= EMPTY_GRACE_POLLS) {
					onStatus?.(
						`All ${total} checks finished for ${mode} (suites never fully settled, proceeding).`,
					);
					return { checks, timedOut: false, polls, mode };
				}
			}
			const note = suitesComplete ? "" : " (suites still settling)";
			onStatus?.(
				`Poll ${polls}: ${total - pending}/${total} checks finished for ${mode}, ${pending} still running${note}…`,
			);
		}

		const interval = polls <= SHORT_PHASE_POLLS ? POLL_INTERVAL_SHORT_MS : POLL_INTERVAL_LONG_MS;
		await sleep(interval, signal);
	}

	return {
		checks: await getChecksForSha(sha, cwd, signal),
		timedOut: true,
		polls,
		mode,
	};
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

async function ghApi(
	endpoint: string,
	jq: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<string> {
	try {
		const { stdout } = await execAsync(`gh api --paginate "${endpoint}" --jq '${jq}'`, {
			cwd,
			timeout: 20_000,
			signal,
		});
		return stdout;
	} catch {
		return "";
	}
}

async function getChecksForSha(
	sha: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	const runsTsv = await ghApi(
		`repos/{owner}/{repo}/commits/${sha}/check-runs`,
		`.check_runs[] | [.name, .status, (.conclusion // ""), (.html_url // "")] | @tsv`,
		cwd,
		signal,
	);
	for (const line of runsTsv.split("\n")) {
		if (!line.trim()) continue;
		const [name, status, conclusion, url] = line.split("\t");
		const { state, bucket } = mapCheckRun(status ?? "queued", conclusion ? conclusion : null);
		results.push({
			name: name ?? "unknown",
			state,
			bucket,
			link: url ? url : null,
		});
	}

	const statusTsv = await ghApi(
		`repos/{owner}/{repo}/commits/${sha}/status`,
		`.statuses[] | [.context, .state, (.target_url // "")] | @tsv`,
		cwd,
		signal,
	);
	for (const line of statusTsv.split("\n")) {
		if (!line.trim()) continue;
		const [name, state, url] = line.split("\t");
		const mapped = mapStatusState(state ?? "pending");
		results.push({
			name: name ?? "unknown",
			state: mapped.state,
			bucket: mapped.bucket,
			link: url ? url : null,
		});
	}

	return results;
}

async function getSuiteStatuses(sha: string, cwd: string, signal?: AbortSignal): Promise<string[]> {
	const raw = await ghApi(
		`repos/{owner}/{repo}/commits/${sha}/check-suites`,
		`.check_suites[] | .status`,
		cwd,
		signal,
	);
	return raw
		.split("\n")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Failure log fetching
// ---------------------------------------------------------------------------

export async function fetchFailureLogs(
	failures: CheckResult[],
	cwd: string,
	signal?: AbortSignal,
): Promise<FailureLog[]> {
	const results: FailureLog[] = [];
	const seenRunIds = new Set<string>();

	for (const check of failures) {
		if (signal?.aborted) break;

		const runId = extractRunId(check.link);

		if (runId && seenRunIds.has(runId)) {
			results.push({
				name: check.name,
				link: check.link,
				runId,
				log: "(see logs above — same workflow run)",
			});
			continue;
		}

		if (runId) seenRunIds.add(runId);

		const log = runId ? await fetchRunLog(runId, cwd, signal) : null;
		results.push({
			name: check.name,
			link: check.link,
			runId,
			log,
		});
	}

	return results;
}

function extractRunId(url: string | null): string | null {
	if (!url) return null;
	const match = url.match(/\/actions\/runs\/(\d+)/);
	return match?.[1] ?? null;
}

async function fetchRunLog(
	runId: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<string | null> {
	// Try --log-failed first (focused output)
	try {
		const { stdout } = await execAsync(`gh run view ${runId} --log-failed 2>&1`, {
			cwd,
			timeout: 30_000,
			signal,
		});
		if (stdout.trim().length > 0) {
			return trimLog(stdout, 200);
		}
	} catch {
		// may exit non-zero or produce nothing
	}

	// Fall back to full log
	try {
		const { stdout } = await execAsync(`gh run view ${runId} --log 2>&1`, {
			cwd,
			timeout: 30_000,
			signal,
		});
		return trimLog(stdout, 300);
	} catch {
		return null;
	}
}

function trimLog(log: string, maxLines: number): string {
	const lines = log.split("\n");
	if (lines.length <= maxLines) return log;
	return `… (${lines.length - maxLines} lines trimmed) …\n` + lines.slice(-maxLines).join("\n");
}

// ---------------------------------------------------------------------------
// Git push detection — re-exported from shared lib
// ---------------------------------------------------------------------------

export {
	isGitPushLine,
	findGitPushInText,
	findGitPushInScript,
	extractScriptPaths,
} from "../../lib/git-utils.ts";

// ---------------------------------------------------------------------------
// PR conflict detection & resolution
// ---------------------------------------------------------------------------

/**
 * Get the base branch name of the current PR (e.g. "main").
 * Returns null if there's no PR or the query fails.
 */
export async function getPrBaseBranch(
	cwd: string,
	signal?: AbortSignal,
): Promise<string | null> {
	try {
		const { stdout } = await execAsync(
			"gh pr view --json baseRefName --jq '.baseRefName' 2>/dev/null",
			{ cwd, timeout: 15_000, signal },
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Get the mergeable status of the current PR.
 * Returns "MERGEABLE", "CONFLICTING", "UNKNOWN", or null (no PR / error).
 */
export async function getPrMergeableStatus(
	cwd: string,
	signal?: AbortSignal,
): Promise<string | null> {
	try {
		const { stdout } = await execAsync(
			"gh pr view --json mergeable --jq '.mergeable' 2>/dev/null",
			{ cwd, timeout: 15_000, signal },
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Get the latest commit SHA of a branch via the GitHub API.
 * Returns null on failure.
 */
export async function getBranchShaViaApi(
	cwd: string,
	branch: string,
	signal?: AbortSignal,
): Promise<string | null> {
	try {
		const { stdout } = await execAsync(
			`gh api "repos/{owner}/{repo}/git/ref/heads/${branch}" --jq '.object.sha' 2>/dev/null`,
			{ cwd, timeout: 15_000, signal },
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/**
 * Merge the latest version of the base branch into the current PR branch.
 *
 * 1. Creates a worktree with the base branch checked out at its latest SHA
 * 2. Verifies the worktree SHA matches what the GitHub API reports
 * 3. Merges the base branch into the current branch (creates a merge commit
 *    if no conflicts, stops with conflicts if there are any)
 *
 * Returns { success, output, conflictPaths }.
 */
export async function mergeBaseBranchIntoCurrent(
	cwd: string,
	baseBranch: string,
	currentBranch: string,
	signal?: AbortSignal,
): Promise<{ success: boolean; output: string; conflictPaths: string[] }> {
	const safeBranch = currentBranch.replace(/[^a-zA-Z0-9_-]/g, "-");
	const worktreePath = `/tmp/vt-pi-merge-${safeBranch}-${Date.now()}`;

	// Helper to clean up the worktree (best-effort).
	const removeWorktree = async () => {
		try {
			await execAsync(`git worktree remove ${worktreePath} --force 2>/dev/null`, {
				cwd,
				timeout: 10_000,
				signal,
			});
		} catch {
			// Best-effort cleanup — ignore failures.
		}
	};

	try {
		// Step 1: Fetch the latest base branch from origin
		await execAsync(`git fetch origin ${baseBranch} 2>&1`, {
			cwd,
			timeout: 30_000,
			signal,
		});

		// Step 2: Create a worktree with the base branch checked out
		await execAsync(`git worktree add ${worktreePath} origin/${baseBranch} 2>&1`, {
			cwd,
			timeout: 30_000,
			signal,
		});

		// Step 3: Verify the worktree's HEAD matches what GitHub says
		const expectedSha = await getBranchShaViaApi(cwd, baseBranch, signal);
		if (expectedSha) {
			const { stdout: actualSha } = await execAsync("git rev-parse HEAD", {
				cwd: worktreePath,
				timeout: 5_000,
				signal,
			});
			if (actualSha.trim() !== expectedSha) {
				// Force-update the local branch ref to match GitHub
				await execAsync(
					`git fetch origin ${baseBranch}:${baseBranch} --force 2>&1`,
					{ cwd, timeout: 30_000, signal },
				);
				await removeWorktree();
				await execAsync(
					`git worktree add ${worktreePath} ${baseBranch} 2>&1`,
					{ cwd, timeout: 30_000, signal },
				);
			}
		}

		// Step 4: Get the SHA to merge from (use the worktree's HEAD)
		const { stdout: baseSha } = await execAsync("git rev-parse HEAD", {
			cwd: worktreePath,
			timeout: 5_000,
			signal,
		});
		const sha = baseSha.trim();

		// Step 5: Merge the base branch into the current PR branch
		// `git merge` performs a merge (not a rebase), creating a merge commit
		// on success. On conflicts it stops and lets the user resolve.
		try {
			const { stdout, stderr } = await execAsync(
				`git merge ${sha} --no-edit 2>&1`,
				{ cwd, timeout: 30_000, signal },
			);
			await removeWorktree();
			return { success: true, output: stdout + stderr, conflictPaths: [] };
		} catch (mergeErr: unknown) {
			const output = extractErrorOutput(mergeErr);
			const conflictPaths = extractConflictPaths(output);
			await removeWorktree();
			return { success: false, output, conflictPaths };
		}
	} catch (err: unknown) {
		await removeWorktree();
		return { success: false, output: extractErrorOutput(err), conflictPaths: [] };
	}
}

/**
 * Parse git merge output to extract paths of files with conflicts.
 */
export function extractConflictPaths(output: string): string[] {
	const paths: string[] = [];
	const regex = /CONFLICT\s+\([^)]+\):\s+Merge conflict in\s+(\S+)/g;
	let match;
	while ((match = regex.exec(output)) !== null) {
		if (!paths.includes(match[1])) {
			paths.push(match[1]);
		}
	}
	return paths;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}
