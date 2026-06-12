/**
 * logic.ts — helpers for git-commit extension.
 *
 * Re-exports pre-check logic from fix-ci and adds git commit helpers.
 */
import { exec, type ChildProcess } from "node:child_process";

// Re-export pre-checks and project detection from fix-ci.
export { runPreChecks, detectProjects } from "../fix-ci/logic.ts";

// Re-export default branch check.
const DEFAULT_BRANCHES = new Set(["main", "master"]);

export function isDefaultBranch(branch: string): boolean {
	return DEFAULT_BRANCHES.has(branch);
}

// ---------------------------------------------------------------------------
// Async exec with abort support
// ---------------------------------------------------------------------------

interface ExecResult {
	stdout: string;
	stderr: string;
}

function execAsync(
	command: string,
	options: { cwd?: string; timeout?: number; signal?: AbortSignal },
): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const child: ChildProcess = exec(
			command,
			{ cwd: options.cwd, timeout: options.timeout },
			(err, stdout, stderr) => {
				cleanup();
				if (err) {
					(err as any).stdout = stdout;
					(err as any).stderr = stderr;
					reject(err);
				} else {
					resolve({ stdout: String(stdout), stderr: String(stderr) });
				}
			},
		);
		const onAbort = () => child.kill();
		options.signal?.addEventListener("abort", onAbort, { once: true });
		const cleanup = () => options.signal?.removeEventListener("abort", onAbort);
	});
}

// ---------------------------------------------------------------------------
// Branch checks
// ---------------------------------------------------------------------------

/**
 * Check if the current branch has an upstream tracking branch configured.
 */
export async function hasUpstreamBranch(
	cwd: string,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		await execAsync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
			cwd,
			timeout: 5_000,
			signal,
		});
		return true;
	} catch {
		// Non-zero exit means no upstream is configured
		return false;
	}
}

/**
 * Check if the current branch exists on the remote.
 * Returns true if branch exists on remote, false otherwise.
 */
export async function branchExistsOnRemote(
	cwd: string,
	branch: string,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const { stdout } = await execAsync(
			`git ls-remote --heads origin ${branch}`,
			{ cwd, timeout: 10_000, signal },
		);
		// ls-remote returns empty if branch doesn't exist
		return stdout.trim().length > 0;
	} catch {
		// If git fails, assume branch doesn't exist
		return false;
	}
}

// ---------------------------------------------------------------------------
// Git commit
// ---------------------------------------------------------------------------

export interface CommitResult {
	success: boolean;
	output: string;
}

function shellEscape(s: string): string {
	return s.replace(/'/g, "'\\''");
}

/**
 * Commit the currently-staged changes with the given message.
 * Does NOT stage anything itself — the caller is responsible for staging
 * (e.g. with `git add`) beforehand.
 * Async to avoid blocking the event loop.
 */
export async function gitCommit(
	cwd: string,
	message: string,
	signal?: AbortSignal,
): Promise<CommitResult> {
	// Check if there's anything staged.
	try {
		await execAsync("git diff --cached --quiet", {
			cwd,
			timeout: 5_000,
			signal,
		});
		// Exit 0 means no staged changes.
		return {
			success: false,
			output: "Nothing to commit — no staged changes. Stage files with `git add` first.",
		};
	} catch {
		// Exit 1 means there ARE staged changes — proceed.
	}

	// Commit.
	try {
		const { stdout, stderr } = await execAsync(
			`git commit -m '${shellEscape(message)}'`,
			{ cwd, timeout: 30_000, signal },
		);
		return { success: true, output: (stdout + stderr).trim() };
	} catch (err: unknown) {
		return { success: false, output: extractErrorOutput(err) };
	}
}

function extractErrorOutput(err: unknown): string {
	if (err && typeof err === "object") {
		if ("stderr" in err && (err as any).stderr) return String((err as any).stderr);
		if ("stdout" in err && (err as any).stdout) return String((err as any).stdout);
	}
	return String(err);
}
