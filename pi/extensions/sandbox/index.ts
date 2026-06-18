import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import {
	checkSandboxBash,
	sandboxActiveToolNames,
	sandboxBlockReason,
} from "./logic.ts";

const SANDBOX_SYSTEM_PROMPT = `

SANDBOX MODE is active for this user request only.
- You may inspect information using read-only operations only.
- Allowed operations are the read tool, the ls tool when available, and simple ls commands via bash.
- Do not modify files, create files, delete files, run tests/builds/installers, use network commands, change git state, or run arbitrary shell commands.
- If the task requires an operation outside these limits, explain that it is not available in sandbox mode and answer as far as possible from read-only inspection.
`;

interface SandboxRun {
	id: number;
	previousTools: string[];
}

export default function (pi: ExtensionAPI) {
	let sandboxRun: SandboxRun | null = null;
	let nextRunId = 1;

	function restoreSandbox(ctx?: { hasUI?: boolean; ui?: { notify?: Function; setStatus?: Function } }) {
		const run = sandboxRun;
		if (!run) return;

		sandboxRun = null;
		pi.setActiveTools(run.previousTools);

		if (ctx?.hasUI) {
			ctx.ui?.setStatus?.("sandbox", undefined);
			ctx.ui?.notify?.("Sandbox mode ended; restored previous tools.", "info");
		}
	}

	pi.registerCommand("sandbox", {
		description: "Run one prompt with only read-only tools (read/ls and simple bash ls)",
		handler: async (args, ctx) => {
			const prompt = args.trim();
			if (!prompt) {
				ctx.ui.notify("Usage: /sandbox <prompt>", "warning");
				return;
			}

			if (sandboxRun) {
				ctx.ui.notify("Sandbox mode is already active for the current response.", "warning");
				return;
			}

			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Run /sandbox after the current response finishes.", "warning");
				return;
			}

			const previousTools = pi.getActiveTools();
			const sandboxTools = sandboxActiveToolNames(pi.getAllTools().map((tool) => tool.name));

			if (sandboxTools.length === 0) {
				ctx.ui.notify("No read-only sandbox tools are available.", "error");
				return;
			}

			sandboxRun = { id: nextRunId++, previousTools };
			pi.setActiveTools(sandboxTools);
			ctx.ui.setStatus("sandbox", "sandbox: read-only");
			ctx.ui.notify(
				`Sandbox mode started with tools: ${sandboxTools.join(", ")}`,
				"info",
			);

			try {
				pi.sendUserMessage(prompt);
			} catch (error) {
				restoreSandbox(ctx);
				throw error;
			}
		},
	});

	pi.on("before_agent_start", async (event) => {
		if (!sandboxRun) return;

		return {
			systemPrompt: event.systemPrompt + SANDBOX_SYSTEM_PROMPT,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!sandboxRun) return;

		if (event.toolName === "read" || event.toolName === "ls") return;

		if (isToolCallEventType("bash", event)) {
			const command = event.input.command ?? "";
			const decision = checkSandboxBash(command);
			if (decision.allowed) return;

			if (ctx.hasUI) {
				ctx.ui.notify("🚫 Sandbox blocked a non-read-only bash command.", "warning");
			}

			return {
				block: true,
				reason: decision.reason,
			};
		}

		if (ctx.hasUI) {
			ctx.ui.notify(`🚫 Sandbox blocked tool \`${event.toolName}\`.`, "warning");
		}

		return {
			block: true,
			reason: sandboxBlockReason(event.toolName),
		};
	});

	pi.on("agent_end", async (_event, ctx) => {
		restoreSandbox(ctx);
	});
}
