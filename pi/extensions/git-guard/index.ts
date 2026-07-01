/**
 * Git Guard Extension
 *
 * Blocks any Pi tool from writing to or editing files inside the .git
 * directory. Prevents accidental or intentional corruption of Git internals.
 *
 * Blocked tools:
 *   - write (creating or overwriting files in .git/)
 *   - edit (modifying files in .git/)
 *   - bash (commands that write to .git/ paths, e.g. cp, mv, rm, redirections)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { isInsideDotGit } from "./logic.ts";

/** Name of the tool call argument that holds the target path. */
const PATH_ARG: Record<string, string> = {
	write: "path",
	edit: "path",
};

/** Tools that write to file paths. */
const WRITE_TOOLS = new Set(["write", "edit"]);

/** Check if a bash command writes to a .git/ path (cp, mv, rm, redirections, etc.). */
function bashTargetsDotGit(command: string): boolean {
	// Look for a path argument that starts with .git/ or contains /.git/
	// after common file-manipulation commands
	const dotGitPattern = /(?:\/|^)\.git(?:\/|$)/;
	
	// Split on pipes, &&, ||, ; to check individual segments
	const segments = command.split(/\|\||&&|;|\|/);
	
	for (const segment of segments) {
		const trimmed = segment.trim();
		// Only check segments with file-manip commands
		if (/^(?:cp|mv|rm|chmod|chown|ln|install)\b/.test(trimmed)) {
			// Extract arguments (skip the command name)
			const args = trimmed.split(/\s+/).slice(1);
			for (const arg of args) {
				if (dotGitPattern.test(arg) && !arg.startsWith("-")) {
					return true;
				}
			}
		}
	}
	
	return false;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		// Block write/edit tools targeting .git/ paths
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const toolType = isToolCallEventType("write", event) ? "write" : "edit";
			const filePath: string | undefined = event.input.path;
			
			if (filePath && isInsideDotGit(filePath)) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`✋ Cannot ${toolType} "${filePath}" — .git directory is protected.`,
						"warning",
					);
				}
				return {
					block: true,
					reason:
						`Cannot ${toolType} "${filePath}" — the .git directory and its contents ` +
						`are protected from modification. Git internals should only be changed ` +
						`through proper Git commands (git commit, git branch, etc.).`,
				};
			}
			return;
		}

		// Block bash commands that target .git/ with file-manipulation tools
		if (isToolCallEventType("bash", event)) {
			const command = event.input.command ?? "";
			if (bashTargetsDotGit(command)) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`🚫 Blocked shell command targeting .git/ directory.`,
						"warning",
					);
				}
				return {
					block: true,
					reason:
						`Shell commands that manipulate files inside .git/ are not allowed. ` +
						`The .git directory and its contents are protected from modification. ` +
						`Use Git Pi tools (git_commit, push_and_check_ci) or proper Git commands ` +
						`to interact with the repository.`,
				};
			}
			return;
		}
	});
}
