/**
 * commit-enforcer/logic.ts — pure git-state checking.
 *
 * No pi imports — testable logic only.
 */
import { execAsync } from "../../lib/exec-async.ts";
import { currentBranch, hasUpstream } from "../../lib/git-utils.ts";

export interface GitState {
	dirty: boolean;
	unpushed: boolean;
}

/**
 * Check whether the working tree has uncommitted changes.
 * Returns false if the directory is not a git repo.
 */
export async function isWorktreeDirty(
	cwd: string,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const result = await execAsync("git status --porcelain", {
			cwd,
			timeout: 5_000,
			signal,
		});
		return result.stdout.trim().length > 0;
	} catch {
		return false;
	}
}

/**
 * Check whether the current branch has commits that haven't been pushed.
 * Requires an upstream to be set. Returns false if not a git repo or
 * no upstream is configured.
 */
export async function hasUnpushedCommits(
	cwd: string,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const branch = currentBranch(cwd);
		if (!branch) return false;

		const upstream = await hasUpstream(cwd, signal);
		if (!upstream) return false;

		const result = await execAsync("git log @{u}..HEAD --oneline", {
			cwd,
			timeout: 5_000,
			signal,
		});
		return result.stdout.trim().length > 0;
	} catch {
		return false;
	}
}

/**
 * Convenience: check both dirty worktree and unpushed commits.
 */
export async function checkGitState(
	cwd: string,
	signal?: AbortSignal,
): Promise<GitState> {
	const [dirty, unpushed] = await Promise.all([
		isWorktreeDirty(cwd, signal),
		hasUnpushedCommits(cwd, signal),
	]);
	return { dirty, unpushed };
}

export const MAX_ENFORCEMENTS = 3;

/**
 * Build the nag message the agent sees when enforcement triggers.
 */
export function buildNagMessage(
	dirty: boolean,
	unpushed: boolean,
	count: number,
	max: number,
): string {
	const issues: string[] = [];
	if (dirty) issues.push("uncommitted changes in the working tree");
	if (unpushed) issues.push("committed but unpushed commits");

	const preamble = `## ⚠️ Pending Git Changes\n\nYou have ${issues.join(" and ")}. Before yielding back, resolve them:\n\n`;
	const options =
		"1. ✅ Commit the changes using `git_commit` (or discard with `git checkout -- .`)\n" +
		"2. ✅ Push committed changes using `push_and_check_ci`\n" +
		"3. 🏳️ Yield back anyway by calling `yield_with_uncommitted_changes` with a reason\n\n";

	const escalation =
		count >= max
			? ""
			: `*(Reminder ${count}/${max} — ${max - count} more before I stop asking)*`;

	return preamble + options + escalation;
}