/**
 * commit-enforcer — prevents the agent from yielding back without
 * committing+ pushing changes.
 *
 * At `agent_end`, checks git state. If dirty or unpushed, injects a
 * follow-up message demanding the agent commit/push or use the escape
 * hatch `yield_with_uncommitted_changes(reason)`.
 *
 * After MAX_ENFORCEMENTS (3) reminders without resolution, it gives up
 * and notifies the user directly.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	checkGitState,
	buildNagMessage,
	MAX_ENFORCEMENTS,
} from "./logic.ts";

// ── In-memory state (per-session) ───────────────────────────────────────────
let yieldedWithReason: string | null = null;
let enforcementCount = 0;

const ENFORCER_SYSTEM_PROMPT = `

## Commit Enforcement Policy

Before yielding back control, you MUST resolve any pending git state:

1. If the working tree has uncommitted changes, you MUST commit them using \`git_commit\`
   or discard them (e.g. \`git checkout -- .\`).
2. If there are committed but unpushed changes, you MUST push them using \`push_and_check_ci\`.

If you have a valid reason not to commit or push, call
\`yield_with_uncommitted_changes(reason: "...")\` to yield back anyway.
This is your last resort — always prefer committing and pushing.
`;

function resetState() {
	yieldedWithReason = null;
	enforcementCount = 0;
}

export default function (pi: ExtensionAPI) {
	// ── Tool: yield_with_uncommitted_changes (escape hatch) ────────────────
	pi.registerTool({
		name: "yield_with_uncommitted_changes",
		label: "Yield With Uncommitted Changes",
		description:
			"Yield back control even though there are uncommitted changes or " +
			"unpushed commits. Use this ONLY as a last resort when you cannot " +
			"commit or push but need to yield back. You must provide a reason.",
		promptSnippet:
			"Yield back without committing/pushing (requires a reason — last resort only)",
		promptGuidelines: [
			"Use yield_with_uncommitted_changes only as a last resort when you genuinely cannot commit or push.",
			"Always prefer committing with git_commit and pushing with push_and_check_ci.",
		],
		parameters: Type.Object({
			reason: Type.String({
				description:
					"Why you are yielding back without committing or pushing. Be specific.",
			}),
		}),
		async execute(_toolCallId, params) {
			yieldedWithReason = params.reason;
			return {
				content: [
					{
						type: "text" as const,
						text: `Yielded with reason: ${params.reason}`,
					},
				],
				details: { reason: params.reason },
			};
		},
	});

	// ── Hook: add enforcer rules to the system prompt ──────────────────────
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: event.systemPrompt + ENFORCER_SYSTEM_PROMPT,
		};
	});

	// ── Hook: enforce on agent end ────────────────────────────────────────
	pi.on("agent_end", async (_event, ctx) => {
		// ── Escape hatch was used ───────────────────────────────────────
		if (yieldedWithReason) {
			pi.sendMessage({
				customType: "commit-enforcer",
				content: `🏳️ Agent yielded back with uncommitted changes. Reason: ${yieldedWithReason}`,
				display: true,
				details: { reason: yieldedWithReason },
			});
			resetState();
			return;
		}

		// ── Check git state ─────────────────────────────────────────────
		const state = await checkGitState(ctx.cwd, ctx.signal);

		if (!state.dirty && !state.unpushed) {
			// All clean — reset and let the agent yield normally.
			resetState();
			return;
		}

		// ── Max reminders reached — give up ──────────────────────────────
		if (enforcementCount >= MAX_ENFORCEMENTS) {
			const issues: string[] = [];
			if (state.dirty) issues.push("uncommitted changes");
			if (state.unpushed) issues.push("unpushed commits");

			pi.sendMessage({
				customType: "commit-enforcer",
				content: [
					{
						type: "text" as const,
						text:
							`⚠️ Gave up enforcing after ${MAX_ENFORCEMENTS} reminders ` +
							`— ${issues.join(" and ")} still pending. Notifying user directly.`,
					},
				],
				display: true,
				details: { ...state, exhausted: true },
			});

			if (ctx.hasUI) {
				const items: string[] = [];
				if (state.dirty) items.push("uncommitted changes");
				if (state.unpushed) items.push("unpushed commits");
				ctx.ui.notify(
					`⚠️ Commit enforcer: ${items.join(" and ")} still pending after ${MAX_ENFORCEMENTS} reminders.`,
					"warning",
				);
			}

			resetState();
			return;
		}

		// ── Remind the agent ────────────────────────────────────────────
		enforcementCount++;
		const message = buildNagMessage(
			state.dirty,
			state.unpushed,
			enforcementCount,
			MAX_ENFORCEMENTS,
		);

		pi.sendUserMessage(message);
	});
}