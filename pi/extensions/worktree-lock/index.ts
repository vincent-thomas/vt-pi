/**
 * worktree-lock extension
 *
 * Locks the agent's working context into a specific git worktree directory.
 * When locked, every tool call is transparently rerouted to the worktree:
 *
 *  - bash commands:  `cd <worktree> && <original-command>`
 *  - read/write/edit: paths resolved relative to the worktree root
 *  - git_commit → worktree_commit  (runs checks + commit in the worktree)
 *  - push_and_check_ci → worktree_push  (runs checks + push + CI poll in the worktree)
 *
 * Commands:
 *  /worktree-enter <name>   lock into ../pi-worktrees/<name>
 *  /worktree-leave          release the lock, restore main-repo tools
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
	runPreChecks,
	isDefaultBranch,
	hasUpstreamBranch,
	branchExistsOnRemote,
	gitCommit,
	gitPush,
	currentBranch,
} from "./logic.ts";
import {
	pollChecks,
	fetchFailureLogs,
	isFailure,
	hasUnpushedCommits,
	getHeadSha,
	findGitPushInText,
	findGitPushInScript,
	extractScriptPaths,
	type CheckResult,
	type FailureLog,
} from "../fix-ci/logic.ts";

// ---------------------------------------------------------------------------
// Lock state
// ---------------------------------------------------------------------------

let lockedWorktree: string | null = null;

function isLocked(): boolean {
	return lockedWorktree !== null;
}

// Tool names to swap
const MAIN_TOOLS = ["git_commit", "push_and_check_ci"];
const WORKTREE_TOOLS = ["worktree_commit", "worktree_push"];

function swapTools(pi: ExtensionAPI, remove: string[], add: string[]) {
	const current = pi.getActiveTools();
	const next = current.filter((t) => !remove.includes(t));
	for (const t of add) {
		if (!next.includes(t)) next.push(t);
	}
	pi.setActiveTools(next);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// ── Restore lock state from session on startup ──────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		lockedWorktree = null;
		// Walk session entries for last worktree_lock entry
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i];
			if (
				e &&
				typeof e === "object" &&
				(e as any).type === "custom_message" &&
				(e as any).customType === "worktree_lock"
			) {
				const data = (e as any).details as { path?: string } | undefined;
				if (data?.path) {
					lockedWorktree = data.path;
					swapTools(pi, MAIN_TOOLS, WORKTREE_TOOLS);
				}
				break;
			}
		}
	});

	// ── Command: /worktree-enter <name> ────────────────────────────────────
	pi.registerCommand("worktree-enter", {
		description: "Lock the agent into a specific git worktree. All file and git operations are routed to that directory.",
		handler: async (args, ctx) => {
			const name = args.trim();
			if (!name) {
				ctx.ui.notify("Usage: /worktree-enter <name>", "warning");
				return;
			}

			// Compute worktree path: sibling pi-worktrees/<name> relative to main repo
			let mainDir: string;
			try {
				const stdout = execSync(
					"git worktree list | head -1 | awk '{print $1}'",
					{ cwd: ctx.cwd, stdio: ["pipe", "pipe", "pipe"], shell: true },
				);
				mainDir = stdout.toString().trim();
			} catch {
				ctx.ui.notify("Not in a git repository, or no worktrees exist.", "error");
				return;
			}

			const worktreePath = resolve(dirname(mainDir), "pi-worktrees", name);
			if (!existsSync(worktreePath)) {
				ctx.ui.notify(
					`Worktree "${name}" not found at ${worktreePath}. Create it first with /skill:worktree init ${name}.`,
					"error",
				);
				return;
			}

			// Persist lock
			pi.appendEntry("worktree_lock", { path: worktreePath });

			// Activate lock
			lockedWorktree = worktreePath;
			swapTools(pi, MAIN_TOOLS, WORKTREE_TOOLS);

			ctx.ui.setStatus("worktree-lock", ctx.ui.theme.fg("accent", `🔒 worktree: ${name}`));
			ctx.ui.notify(`Locked into worktree: ${name} (${worktreePath})`, "info");
		},
	});

	// ── Command: /worktree-leave ───────────────────────────────────────────
	pi.registerCommand("worktree-leave", {
		description: "Release the worktree lock and return to the main repository context.",
		handler: async (_args, ctx) => {
			if (!isLocked()) {
				ctx.ui.notify("Not locked into any worktree.", "info");
				return;
			}

			const prev = lockedWorktree;
			lockedWorktree = null;
			swapTools(pi, WORKTREE_TOOLS, MAIN_TOOLS);

			pi.appendEntry("worktree_lock", { path: null });

			ctx.ui.setStatus("worktree-lock", undefined);
			ctx.ui.notify(`Left worktree: ${prev}`, "info");
		},
	});

	// ── Tool: worktree_commit ──────────────────────────────────────────────
	pi.registerTool({
		name: "worktree_commit",
		label: "Worktree Commit",
		description:
			"Commit staged changes in the locked worktree. Same semantics as git_commit but operates on the worktree directory. Only available when locked into a worktree.",
		parameters: Type.Object({
			message: Type.String({
				description: "Commit message. Be specific about what changed and why.",
			}),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = lockedWorktree;
			if (!cwd) {
				return {
					content: [{ type: "text" as const, text: "Not locked into a worktree. Use /worktree-enter <name> first." }],
				};
			}

			// 1. Check default branch.
			const branch = currentBranch(cwd);
			if (branch && isDefaultBranch(branch)) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								`Cannot commit on "${branch}". ` +
								`Create a feature branch first with the worktree skill, ` +
								`then commit there.`,
						},
					],
				};
			}

			// 2. Check remote branch existence.
			if (branch && (await hasUpstreamBranch(cwd, signal))) {
				if (!(await branchExistsOnRemote(cwd, branch, signal))) {
					return {
						content: [
							{
								type: "text" as const,
								text:
									`Branch "${branch}" has an upstream configured but does not exist on remote. ` +
									`This may indicate a deleted remote branch. Push it with worktree_push ` +
									`or \`git -C ${cwd} push -u origin ${branch}\`.`,
							},
						],
					};
				}
			}

			// 3. Pre-commit checks.
			const completedSteps: string[] = [];
			onUpdate?.({ content: [{ type: "text", text: "Running pre-commit checks…" }] });

			const preCheck = await runPreChecks(cwd, signal, (step) => {
				const icon = step.passed ? "✅" : "❌";
				const time = step.elapsed ? ` (${step.elapsed}s)` : "";
				completedSteps.push(`${icon} ${step.command}${time}`);
				onUpdate?.({ content: [{ type: "text", text: completedSteps.join("\n") }] });
			});

			if (!preCheck.passed) {
				const failedStep = preCheck.steps.find((s) => !s.passed)!;
				const passedSteps = preCheck.steps
					.filter((s) => s.passed)
					.map((s) => `✅ ${s.command}`)
					.join("\n");
				return {
					content: [
						{
							type: "text" as const,
							text:
								`Pre-commit check failed. Fix the errors before committing.\n\n` +
								(passedSteps ? `${passedSteps}\n` : "") +
								`❌ \`${failedStep.command}\`:\n\`\`\`\n${failedStep.output}\n\`\`\``,
						},
					],
				};
			}

			// 4. Commit.
			if (preCheck.steps.length > 0) {
				completedSteps.push("Committing…");
				onUpdate?.({ content: [{ type: "text", text: completedSteps.join("\n") }] });
			} else {
				onUpdate?.({ content: [{ type: "text", text: "Committing…" }] });
			}

			const result = await gitCommit(cwd, params.message, signal);

			if (!result.success) {
				return {
					content: [{ type: "text" as const, text: `Commit failed:\n\`\`\`\n${result.output}\n\`\`\`` }],
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: result.output || `Committed in worktree: "${params.message}"`,
					},
				],
			};
		},
	});

	// ── Tool: worktree_push ────────────────────────────────────────────────
	const MAX_CYCLES = 3;
	let pushCycleCount = 0;

	pi.registerTool({
		name: "worktree_push",
		label: "Worktree Push",
		description:
			"Push the locked worktree branch and poll CI. Same semantics as push_and_check_ci but operates on the worktree directory. Only available when locked into a worktree.",
		parameters: Type.Object({}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = lockedWorktree;
			if (!cwd) {
				return {
					content: [{ type: "text" as const, text: "Not locked into a worktree. Use /worktree-enter <name> first." }],
				};
			}

			const hasSomethingToPush = await hasUnpushedCommits(cwd, signal);
			let pushedSha: string | undefined;

			if (hasSomethingToPush) {
				pushCycleCount++;
				const cycle = pushCycleCount;

				// 1. Pre-push checks
				const completedSteps: string[] = [];
				onUpdate?.({ content: [{ type: "text", text: "Running pre-push checks…" }] });

				const preCheck = await runPreChecks(cwd, signal, (step) => {
					const icon = step.passed ? "✅" : "❌";
					const time = step.elapsed ? ` (${step.elapsed}s)` : "";
					completedSteps.push(`${icon} ${step.command}${time}`);
					onUpdate?.({ content: [{ type: "text", text: completedSteps.join("\n") }] });
				});

				if (!preCheck.passed) {
					pushCycleCount--;
					const failedStep = preCheck.steps.find((s) => !s.passed)!;
					const passed = preCheck.steps
						.filter((s) => s.passed)
						.map((s) => `✅ ${s.command}`)
						.join("\n");
					return {
						content: [
							{
								type: "text",
								text:
									`Pre-push check failed.\n\n` +
									(passed ? `${passed}\n` : "") +
									`❌ \`${failedStep.command}\`:\n\`\`\`\n${failedStep.output}\n\`\`\``,
							},
						],
					};
				}

				// 2. Push
				onUpdate?.({ content: [{ type: "text", text: "Pushing to origin…" }] });
				const pushResult = await gitPush(cwd, signal);
				if (!pushResult.success) {
					pushCycleCount = 0;
					return {
						content: [
							{
								type: "text",
								text: `git push failed:\n\n\`\`\`\n${pushResult.output}\n\`\`\``,
							},
						],
					};
				}

				pushedSha = (await getHeadSha(cwd, signal)) ?? undefined;
			} else {
				onUpdate?.({ content: [{ type: "text", text: "Nothing to push — checking CI for current HEAD…" }] });
				pushedSha = (await getHeadSha(cwd, signal)) ?? undefined;
			}

			const cycle = pushCycleCount;

			// 3. Poll CI
			onUpdate?.({ content: [{ type: "text", text: `Push succeeded. Polling CI (cycle ${cycle}/${MAX_CYCLES})…` }] });
			const pollResult = await pollChecks(cwd, signal, (status) => {
				onUpdate?.({ content: [{ type: "text", text: status }] });
			}, pushedSha);

			if (pollResult.timedOut) {
				pushCycleCount = 0;
				return {
					content: [
						{
							type: "text",
							text:
								`Timed out after ${pollResult.polls} polls on ${pollResult.mode}. Some checks are still running.`,
						},
					],
				};
			}

			const failures = pollResult.checks.filter((c) => isFailure(c.bucket));

			if (pollResult.checks.length === 0) {
				pushCycleCount = 0;
				return {
					content: [
						{
							type: "text",
							text: `No CI checks are configured for ${pollResult.mode}. The push succeeded, but nothing ran.`,
						},
					],
				};
			}

			if (failures.length === 0) {
				pushCycleCount = 0;
				return {
					content: [
						{
							type: "text",
							text:
								`All ${pollResult.checks.length} checks passed for ${pollResult.mode}. ✅\n\n` +
								formatChecks(pollResult.checks),
						},
					],
				};
			}

			// 4. Fetch failure logs
			onUpdate?.({ content: [{ type: "text", text: `${failures.length} check(s) failed. Fetching logs…` }] });
			const failureLogs = await fetchFailureLogs(failures, cwd, signal);
			const report = buildReport(pollResult.mode, pollResult.checks, failures, failureLogs);

			if (cycle >= MAX_CYCLES) {
				pushCycleCount = 0;
				return {
					content: [
						{
							type: "text",
							text:
								report +
								`\n\nThis was attempt ${cycle}/${MAX_CYCLES}. Stop here and tell the user.`,
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text",
						text:
							report +
							`\n\nThis is attempt ${cycle}/${MAX_CYCLES}. Fix the failures with minimal changes, ` +
							`commit with worktree_commit, then call worktree_push again.`,
					},
				],
			};
		},
	});

	// ── Bash wrapping ──────────────────────────────────────────────────────
	pi.on("tool_call", async (event, ctx) => {
		if (!isLocked()) return;

		// Wrap bash: cd into worktree before every command
		if (isToolCallEventType("bash", event)) {
			event.input.command = `cd ${lockedWorktree} && ${event.input.command ?? ""}`;
			return;
		}

		// Resolve file paths relative to worktree
		if (
			isToolCallEventType("read", event) ||
			isToolCallEventType("write", event) ||
			isToolCallEventType("edit", event)
		) {
			const path = event.input.path;
			if (path && !path.startsWith("/")) {
				event.input.path = resolve(lockedWorktree!, path);
			}
			return;
		}
	});

	// ── System prompt injection ────────────────────────────────────────────
	pi.on("before_agent_start", async (event) => {
		if (!isLocked()) return;

		const branch = currentBranch(lockedWorktree!);
		return {
			systemPrompt:
				event.systemPrompt +
				`\n\n⚠️  You are LOCKED into a worktree: ${lockedWorktree} (branch: ${branch ?? "unknown"}).\n` +
				`- All bash commands automatically run inside this directory (cd is prepended).\n` +
				`- All file paths (read, write, edit) are resolved relative to this directory.\n` +
				`- Use \`worktree_commit\` to commit (git_commit is unavailable while locked).\n` +
				`- Use \`worktree_push\` to push and check CI (push_and_check_ci is unavailable while locked).\n` +
				`- Use \`/worktree-leave\` to return to the main repo.\n`,
		};
	});
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatChecks(checks: CheckResult[]): string {
	return checks
		.map((c) => {
			const icon = isFailure(c.bucket) ? "❌" : c.bucket === "pass" ? "✅" : "⏭️";
			return `${icon} ${c.name}: ${c.state}`;
		})
		.join("\n");
}

function buildReport(
	mode: string,
	allChecks: CheckResult[],
	failures: CheckResult[],
	failureLogs: FailureLog[],
): string {
	const passed = allChecks.filter((c) => !isFailure(c.bucket));
	const lines: string[] = [];

	lines.push(`## CI Results for ${mode}`);
	lines.push("");
	lines.push(`**${failures.length} failed**, ${passed.length} passed`);
	lines.push("");

	if (passed.length > 0) {
		lines.push("### Passed");
		for (const c of passed) lines.push(`- ✅ ${c.name}`);
		lines.push("");
	}

	lines.push("### Failures");
	lines.push("");
	for (const fl of failureLogs) {
		lines.push(`#### ❌ ${fl.name}`);
		if (fl.link) lines.push(`URL: ${fl.link}`);
		lines.push("");
		if (fl.log) {
			lines.push("```");
			lines.push(fl.log);
			lines.push("```");
		} else {
			lines.push("_(no logs available)_");
		}
		lines.push("");
	}

	return lines.join("\n");
}
