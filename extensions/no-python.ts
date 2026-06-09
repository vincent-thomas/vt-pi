/**
 * No Python Extension
 *
 * Blocks any bash tool call that executes Python, not just `python -c`.
 * This covers:
 *   - `python -c "..."`            inline code
 *   - `python script.py`           running a script
 *   - `python <<EOF … EOF`         heredocs
 *   - `env python …` / `/usr/bin/python …` / `python3.12 …`
 *   - the same anywhere in a pipeline or command substitution
 *
 * Returns an explaining message to the model when a call is blocked.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { findCommandUse, isPythonCommand } from "../lib/command-utils.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command ?? "";
		const hit = findCommandUse(command, isPythonCommand);
		if (!hit) return;

		if (ctx.hasUI) {
			ctx.ui.notify("🐍 Blocked Python execution.", "warning");
		}

		return {
			block: true,
			reason:
				`Python execution is not allowed (blocked: \`${hit.segment}\`). ` +
				`This covers \`python\`/\`python3\`, \`-c\` snippets, running scripts, ` +
				`heredocs (\`python <<EOF\`), and \`env python …\`. ` +
				`Prefer other bash tools — for example, use \`jq\` to parse JSON.`,
		};
	});
}
