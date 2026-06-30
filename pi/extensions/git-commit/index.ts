/**
 * git-commit extension
 *
 * 1. `git_commit` tool — checks default branch, runs pre-checks (static
 *    analysis only), then commits the currently-staged changes with
 *    the provided message. Does NOT stage anything itself.
 *
 * 2. Blocks ALL manual `git commit` in bash — the AI must use the tool.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	findGitCommitInText,
	findGitCommitInScript,
	extractScriptPaths,
	currentBranch,
} from "../../lib/git-utils.ts";
import { isDefaultBranch, hasUpstreamBranch, branchExistsOnRemote } from "./logic.ts";
import { runPreChecks, gitCommit } from "./logic.ts";
import { execAsync } from "../../lib/exec-async.ts";

export default function (pi: ExtensionAPI) {
	// ── Tool: git_commit ──────────────────────────────────────────────────────
	pi.registerTool({
		name: "git_commit",
		label: "Git Commit",
		description:
			"Commit the currently-staged changes with the provided message. " +
			"Pass `add_all: true` to auto-stage all tracked file changes first. " +
			"Runs pre-commit checks (static analysis only) before committing. " +
			"Blocks commits on default branches (main/master). " +
			"You MUST use this tool instead of running `git commit` in bash.",
		parameters: Type.Object({
			message: Type.String({
				description: "Commit message. Be specific about what changed and why.",
			}),
			add_all: Type.Boolean({
				description:
					"Auto-stage all changes (`git add -A`) before committing. " +
					"Set to true for quick checkpoints where you want everything changed to be included.",
			}),
		}),

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cwd = ctx.cwd;

			// 1. Check default branch.
			const branch = currentBranch(cwd);
			if (branch && isDefaultBranch(branch)) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								`Cannot commit on "${branch}". ` +
								`Create a feature branch first with \`git checkout -b <branch-name>\`, ` +
								`then commit there.`,
						},
					],
				};
			}

			// 2. Check if branch exists on remote (only if it has an upstream).
			if (branch && (await hasUpstreamBranch(cwd, signal))) {
				if (!(await branchExistsOnRemote(cwd, branch, signal))) {
					return {
						content: [
							{
								type: "text" as const,
								text:
									`Branch "${branch}" has an upstream configured but does not exist on remote. ` +
									`This may indicate a deleted remote branch. Push it with \`push_and_check_ci\` or ` +
									`\`git push -u origin ${branch}\`.`,
							},
						],
					};
				}
			}

			// 3. Pre-commit checks.
			const completedSteps: string[] = [];
			onUpdate?.({
				content: [{ type: "text", text: "Running pre-commit checks…" }],
			});

			const preCheck = await runPreChecks(cwd, signal, (step) => {
				const icon = step.passed ? "✅" : "❌";
				const time = step.elapsed ? ` (${step.elapsed}s)` : "";
				completedSteps.push(`${icon} ${step.command}${time}`);
				onUpdate?.({
					content: [{ type: "text", text: completedSteps.join("\n") }],
				});
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

			// 4. Auto-stage if add_all is set.
			if (params.add_all) {
				completedSteps.push("📦 Staging all changes…");
				onUpdate?.({
					content: [{ type: "text", text: completedSteps.join("\n") }],
				});

				try {
					await execAsync("git add -A", { cwd, timeout: 15_000, signal });
				} catch (err: unknown) {
					const output = err instanceof Error ? err.message : String(err);
					return {
						content: [
							{
								type: "text" as const,
								text: `Staging failed:\n\`\`\`\n${output}\n\`\`\``,
							},
						],
					};
				}
			}

			// 5. Commit.
			if (preCheck.steps.length > 0 || params.add_all) {
				completedSteps.push("Committing…");
				onUpdate?.({
					content: [{ type: "text", text: completedSteps.join("\n") }],
				});
			} else {
				onUpdate?.({
					content: [{ type: "text", text: "Committing…" }],
				});
			}

			const result = await gitCommit(cwd, params.message, signal);

			if (!result.success) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Commit failed:\n\`\`\`\n${result.output}\n\`\`\``,
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: result.output || `Committed: "${params.message}"`,
					},
				],
			};
		},
	});

	// ── Block manual `git commit` in bash ─────────────────────────────────────
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command ?? "";

		// Check inline command
		const inlineHit = findGitCommitInText(cmd);
		if (inlineHit) {
			if (ctx.hasUI) {
				ctx.ui.notify("✋ Blocked `git commit` — use the git_commit tool.", "warning");
			}
			return {
				block: true,
				reason:
					`Do not run \`git commit\` directly in bash. ` +
					`Use the \`git_commit\` tool instead. Blocked command: ${inlineHit}`,
			};
		}

		// Check scripts being executed
		for (const scriptPath of extractScriptPaths(cmd)) {
			const scriptHit = findGitCommitInScript(scriptPath, ctx.cwd);
			if (scriptHit) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`✋ Blocked script with git commit — use the git_commit tool.`,
						"warning",
					);
				}
				return {
					block: true,
					reason:
						`Cannot execute "${scriptPath}" — it contains git commit. ` +
						`Use the \`git_commit\` tool instead. Blocked line: ${scriptHit}`,
				};
			}
		}
	});
}
