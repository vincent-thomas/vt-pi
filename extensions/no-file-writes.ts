/**
 * No File Writes Extension
 *
 * Blocks bash commands that write to files via redirection (>, >>), preventing
 * circumvention of the `write` and `edit` tools.
 *
 * Blocked patterns:
 *   - `echo ... > file` / `echo ... >> file`
 *   - `printf ... > file` / `printf ... >> file`
 *   - `cat ... > file` (even though cat is already banned)
 *   - Any command with file redirections
 *
 * Allowed:
 *   - `echo "message"` (stdout only)
 *   - `ls | grep foo` (pipes to other commands)
 *   - `command > /dev/null` (discarding output)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

/**
 * Detects file write redirections: `> file` or `>> file`.
 * Excludes common non-file targets like /dev/null, /dev/stderr, /dev/stdout, &1, &2.
 */
function hasFileWriteRedirection(command: string): { found: boolean; segment?: string } {
	// Match > or >> followed by something that looks like a file path
	// Exclude: /dev/null, /dev/std*, &1, &2
	const pattern = /(\s|^)(>>?)\s+(?!\/dev\/|&[12]\b)(\S+)/g;
	const match = pattern.exec(command);
	
	if (match) {
		return {
			found: true,
			segment: match[0].trim(),
		};
	}
	
	return { found: false };
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command ?? "";
		const detection = hasFileWriteRedirection(command);
		
		if (!detection.found) return;

		if (ctx.hasUI) {
			ctx.ui.notify("🚫 Blocked file write redirection.", "warning");
		}

		return {
			block: true,
			reason:
				`File write redirections are not allowed (blocked: \`${detection.segment}\`). ` +
				`Use the \`write\` tool to create files or the \`edit\` tool to modify them. ` +
				`This ensures precise, reviewable changes instead of shell redirections.`,
		};
	});
}
