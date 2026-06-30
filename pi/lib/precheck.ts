/**
 * precheck.ts — shared pre-commit / pre-push static analysis helpers.
 *
 * Detects project type from marker files and runs project-appropriate checks
 * (e.g. `cargo check`, `npx tsc --noEmit`).
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

interface ProjectType {
	name: string;
	checks: string[];
}

// ---------------------------------------------------------------------------
// Project type detection
// ---------------------------------------------------------------------------

const PROJECT_TYPES: {
	markers: string[];
	project: ProjectType;
}[] = [
	{
		markers: ["Cargo.toml"],
		project: {
			name: "rust",
			checks: ["cargo check"],
		},
	},
	{
		markers: ["package.json"],
		project: {
			name: "node",
			checks: ["npx tsc --noEmit"],
		},
	},
	{
		markers: ["go.mod"],
		project: {
			name: "go",
			checks: ["go vet ./..."],
		},
	},
	{
		markers: ["pyproject.toml", "setup.py", "setup.cfg"],
		project: {
			name: "python",
			checks: [
				"python -m py_compile $(git diff --name-only --cached -- '*.py' | head -50 || true)",
			],
		},
	},
];

/**
 * Detect what project types are present in cwd based on marker files.
 */
export function detectProjects(cwd: string): ProjectType[] {
	const found: ProjectType[] = [];
	for (const { markers, project } of PROJECT_TYPES) {
		for (const marker of markers) {
			if (existsSync(resolve(cwd, marker))) {
				found.push(project);
				break;
			}
		}
	}
	return found;
}

// ---------------------------------------------------------------------------
// Pre-check runner
// ---------------------------------------------------------------------------

/**
 * Run the registered pre-checks for all detected project types.
 *
 * Stops at the first failure and returns immediately. Progress is reported
 * via the optional `onStep` callback.
 */
export async function runPreChecks(
	cwd: string,
	signal?: AbortSignal,
	onStep?: (step: PreCheckResult["steps"][0]) => void,
): Promise<PreCheckResult> {
	const projects = detectProjects(cwd);
	if (projects.length === 0) return { passed: true, steps: [] };

	const steps: PreCheckResult["steps"] = [];

	for (const project of projects) {
		for (const command of project.checks) {
			if (signal?.aborted) return { passed: false, steps };
			const start = Date.now();
			try {
				const { stdout, stderr } = await execAsync(command, {
					cwd,
					timeout: 120_000,
					signal,
				});
				const elapsed = ((Date.now() - start) / 1000).toFixed(1);
				const step = { command, passed: true, output: stdout + stderr, elapsed };
				steps.push(step);
				onStep?.(step);
			} catch (err: unknown) {
				const elapsed = ((Date.now() - start) / 1000).toFixed(1);
				const output = extractErrorOutput(err);
				const step = { command, passed: false, output, elapsed };
				steps.push(step);
				onStep?.(step);
				return { passed: false, steps };
			}
		}
	}

	return { passed: true, steps };
}