/**
 * exec-async.ts — shared async exec with abort-signal support.
 *
 * Provides a promisified child_process.exec that:
 *  - Threads through AbortSignal (Ctrl+C kills child processes)
 *  - Attaches stdout/stderr to the rejection error for callers that need them
 *
 * No pi imports — importable from any extension's logic module.
 */

import { exec, type ChildProcess } from "node:child_process";

export interface ExecResult {
	stdout: string;
	stderr: string;
}

/**
 * Async exec that kills the child process when the signal fires.
 * Rejects on non-zero exit or timeout.
 */
export function execAsync(
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
					// Attach stdout/stderr to the error for callers that need them.
					(err as any).stdout = stdout;
					(err as any).stderr = stderr;
					reject(err);
				} else {
					resolve({ stdout: String(stdout), stderr: String(stderr) });
				}
			},
		);

		const onAbort = () => {
			child.kill();
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		const cleanup = () => {
			options.signal?.removeEventListener("abort", onAbort);
		};
	});
}

/**
 * Extract readable output from an exec error.
 * Prefers stderr, then stdout, falls back to toString.
 */
export function extractErrorOutput(err: unknown): string {
	if (err && typeof err === "object") {
		if ("stderr" in err && (err as any).stderr) return String((err as any).stderr);
		if ("stdout" in err && (err as any).stdout) return String((err as any).stdout);
	}
	return String(err);
}