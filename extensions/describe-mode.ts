/**
 * describe-mode extension
 *
 * Provides a `/describe <what>` command that enters read-only exploration mode.
 * In this mode, only the `read` tool and `bash ls` command are allowed.
 * All other tool calls (write, edit, git operations, etc.) are blocked.
 *
 * This is useful for having the AI explore and describe a codebase without
 * making any changes.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	let describeMode = false;
	let describeTarget = "";

	// Register the /describe command
	pi.registerCommand("describe", {
		description: "Enter read-only mode to explore and describe code. Usage: /describe <what>",
		handler: async (args, ctx) => {
			if (!args || args.trim().length === 0) {
				ctx.ui.notify("Usage: /describe <what>", "warning");
				return;
			}

			describeMode = true;
			describeTarget = args.trim();

			ctx.ui.notify(
				`📖 Describe mode active. Only 'read' and 'bash ls' allowed.`,
				"info",
			);

			// Inject a system message to guide the AI
			await ctx.sendMessage({
				role: "user",
				content: [
					{
						type: "text",
						text:
							`Please describe: ${describeTarget}\n\n` +
							`You are now in read-only exploration mode. You can:\n` +
							`- Use the 'read' tool to read files\n` +
							`- Use 'bash' with ONLY 'ls' commands to list directories\n\n` +
							`All other operations (write, edit, git, etc.) are blocked.\n` +
							`Explore the codebase and provide a detailed description.`,
					},
				],
			});
		},
	});

	// Register /exit-describe command to leave the mode
	pi.registerCommand("exit-describe", {
		description: "Exit read-only describe mode",
		handler: async (_args, ctx) => {
			if (!describeMode) {
				ctx.ui.notify("Not in describe mode", "info");
				return;
			}

			describeMode = false;
			describeTarget = "";
			ctx.ui.notify("📝 Describe mode disabled. All tools available.", "info");
		},
	});

	// Intercept all tool calls when in describe mode
	pi.on("tool_call", async (event, ctx) => {
		if (!describeMode) return; // Not in describe mode, allow everything

		// Allow 'read' tool
		if (isToolCallEventType("read", event)) {
			return; // Allow
		}

		// Allow 'bash' tool only if it's an ls command
		if (isToolCallEventType("bash", event)) {
			const command = event.input.command ?? "";
			const trimmed = command.trim();

			// Check if it's a pure ls command (with optional flags)
			// Allow: ls, ls -la, ls some/path, ls -lah ., etc.
			// Block: anything with pipes, redirects, or other commands
			if (/^ls(\s|$)/.test(trimmed) && !trimmed.match(/[|;&><]/)) {
				return; // Allow ls commands
			}

			// Block all other bash commands
			if (ctx.hasUI) {
				ctx.ui.notify(
					`🚫 Blocked in describe mode: bash ${trimmed.split(" ")[0]}`,
					"warning",
				);
			}

			return {
				block: true,
				reason:
					`This bash command is blocked in describe mode. ` +
					`Only 'ls' commands are allowed. Use 'read' to view file contents. ` +
					`Type '/exit-describe' to exit read-only mode.`,
			};
		}

		// Block all other tools
		if (ctx.hasUI) {
			ctx.ui.notify(`🚫 Blocked in describe mode: ${event.toolName}`, "warning");
		}

		return {
			block: true,
			reason:
				`The '${event.toolName}' tool is blocked in describe mode. ` +
				`Only 'read' and 'bash ls' are allowed. ` +
				`Type '/exit-describe' to exit read-only mode.`,
		};
	});
}
