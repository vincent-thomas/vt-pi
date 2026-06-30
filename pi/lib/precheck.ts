/**
 * precheck.ts — pre-commit / pre-push validation helper.
 *
 * Runs `make` if a Makefile exists and make is available. The project
 * defines what "valid" means through its Makefile — no harness-side
 * project-type detection.
 *
 * No pi imports — importable from any extension's logic module.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execAsync, extractErrorOutput } from "./exec-async.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreCheckResult {
	passed: boolean;
	steps: { command: string; passed: boolean; output: string; elapsed?: string }[];
}

// ---------------------------------------------------------------------------
// Pre-check runner
// ---------------------------------------------------------------------------

/**
 * Run `make` as a pre-check if a Makefile exists and make is available.
 *
 * Returns immediately with `{ passed: true, steps: [] }` if either
 * condition is not met. Otherwise runs `make` and reports the result.
 */
export async function runPreChecks(
	cwd: string,
	signal?: AbortSignal,
	onStep?: (step: PreCheckResult["steps"][0]) => void,
): Promise<PreCheckResult> {
	// Skip if no Makefile exists.
	if (!existsSync(resolve(cwd, "Makefile"))) {
		return { passed: true, steps: [] };
	}

	// Skip if make isn't installed.
	try {
		await execAsync("which make", { cwd, timeout: 5_000, signal });
	} catch {
		return { passed: true, steps: [] };
	}

	const command = "make";
	const start = Date.now();

	try {
		const { stdout, stderr } = await execAsync(command, {
			cwd,
			timeout: 120_000,
			signal,
		});
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);
		const output = stdout + stderr;
		const step = { command, passed: true, output, elapsed };
		onStep?.(step);
		return { passed: true, steps: [step] };
	} catch (err: unknown) {
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);
		const output = extractErrorOutput(err);
		const step = { command, passed: false, output, elapsed };
		onStep?.(step);
		return { passed: false, steps: [step] };
	}
}