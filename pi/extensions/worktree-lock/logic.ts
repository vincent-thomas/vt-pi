/**
 * worktree-lock logic — helpers for locked worktree operations.
 *
 * Reuses fix-ci and git-commit logic but runs against the locked worktree
 * directory instead of the session cwd.
 */
import { exec, execSync, type ChildProcess } from "node:child_process";

// Re-export helpers from existing logic with worktree cwd support.
export { runPreChecks, detectProjects } from "../fix-ci/logic.ts";
export {
	isDefaultBranch,
	hasUpstreamBranch,
	branchExistsOnRemote,
	gitCommit,
} from "../git-commit/logic.ts";

// ---------------------------------------------------------------------------
// Git push (from fix-ci/logic, duplicated because we need it)
// ---------------------------------------------------------------------------

async function execAsync(
	command: string,
	options: { cwd?: string; timeout?: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
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

async function hasUpstream(cwd: string, signal?: AbortSignal): Promise<boolean> {
	try {
		await execAsync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
			cwd,
			timeout: 5_000,
			signal,
		});
		return true;
	} catch {
		return false;
	}
}

export async function gitPush(cwd: string, signal?: AbortSignal): Promise<{ success: boolean; output: string }> {
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
// Shared helpers
// ---------------------------------------------------------------------------

export function currentBranch(cwd: string): string | null {
	try {
		return (
			execSync("git branch --show-current", {
				cwd,
				stdio: ["pipe", "pipe", "pipe"],
			})
				.toString()
				.trim() || null
		);
	} catch {
		return null;
	}
}

function extractErrorOutput(err: unknown): string {
	if (err && typeof err === "object") {
		if ("stderr" in err && (err as any).stderr) return String((err as any).stderr);
		if ("stdout" in err && (err as any).stdout) return String((err as any).stdout);
	}
	return String(err);
}
