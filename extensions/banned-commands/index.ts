/**
 * banned-commands extension
 *
 * Totally bans `cat`, `tee`, and `sed` in the bash tool. These have safer,
 * first-class tool equivalents (read / write / edit) that don't risk silently
 * dumping or mangling file contents.
 *
 * Detection sees through env prefixes, wrappers (sudo/env), absolute paths,
 * alias-busting backslashes, pipelines, and command substitution.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { findCommandUse, BANNED_COMMANDS, BANNED_NAMES } from "./logic.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command ?? "";
		const hit = findCommandUse(command, BANNED_NAMES);
		if (!hit) return;

		const alternative = BANNED_COMMANDS[hit.name] ?? "";

		if (ctx.hasUI) {
			ctx.ui.notify(`✋ Blocked \`${hit.name}\`.`, "warning");
		}

		return {
			block: true,
			reason:
				`The \`${hit.name}\` command is banned (blocked: \`${hit.segment}\`). ` +
				`${alternative} ` +
				`This applies anywhere in a command, including pipelines and command substitution.`,
		};
	});
}
