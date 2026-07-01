/**
 * Folder Protector Extension
 *
 * Blocks any Pi tool from writing to or editing files inside banned folders
 * (e.g. .git/). Folder names are configured in logic.ts's BANNED_FOLDERS list.
 *
 * Blocked tools:
 *   - write (creating or overwriting files in banned folders)
 *   - edit (modifying files in banned folders)
 *   - bash (commands that write to banned folder paths, e.g. cp, mv, rm)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { BANNED_FOLDERS, isPathInsideBannedFolder } from "./logic.ts";

/** Check if a bash command writes to a banned folder path (cp, mv, rm, etc.). */
function bashTargetsBannedFolder(command: string): string | null {
	// Build a pattern matching any banned folder as a path segment
	const escaped = BANNED_FOLDERS.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const pattern = new RegExp(`(?:^|/)(?:${escaped.join("|")})(?:/|$)`);

	// Split on pipes, &&, ||, ; to check individual segments
	const segments = command.split(/\|\||&&|;|\|/);

	for (const segment of segments) {
		const trimmed = segment.trim();
		// Only check segments with file-manip commands
		if (/^(?:cp|mv|rm|chmod|chown|ln|install)\b/.test(trimmed)) {
			// Extract arguments (skip the command name)
			const args = trimmed.split(/\s+/).slice(1);
			for (const arg of args) {
				if (pattern.test(arg) && !arg.startsWith("-")) {
					return arg;
				}
			}
		}
	}

	return null;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		// Block write/edit tools targeting banned folder paths
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const toolType = isToolCallEventType("write", event) ? "write" : "edit";
			const filePath: string | undefined = event.input.path;

			if (filePath && isPathInsideBannedFolder(filePath, BANNED_FOLDERS)) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`✋ Cannot ${toolType} "${filePath}" — protected folder.`,
						"warning",
					);
				}
				return {
					block: true,
					reason:
						`Cannot ${toolType} "${filePath}" — this path is inside a protected folder. ` +
						`Files inside these directories should not be modified directly.`, 				};
			}
			return;
		}

		// Block bash commands that target banned folders with file-manipulation tools
		if (isToolCallEventType("bash", event)) {
			const command = event.input.command ?? "";
			const match = bashTargetsBannedFolder(command);
			if (match) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`🚫 Blocked shell command targeting protected folder: ${match}`,
						"warning",
					);
				}
				return {
					block: true,
					reason:
						`Shell commands that manipulate files inside protected folders are not allowed. ` +
						`The path "${match}" is inside a protected directory.`, 				};
			}
			return;
		}
	});
}
