/**
 * Write Guard Extension
 *
 * Blocks the `write` tool from overwriting existing files that are above a
 * line threshold. Forces the agent to use `edit` instead, which is safer
 * because it requires matching exact text and can't silently drop content.
 *
 * New files (that don't exist yet) are always allowed.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX_LINES = 50;

/** Returns the base filename from a path string. */
function baseName(p: string): string {
	const idx = p.lastIndexOf("/");
	return idx === -1 ? p : p.slice(idx + 1);
}

/** Name of the Makefile (case-insensitive match target). */
const MAKEFILE_NAME = "makefile";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		// Block both write and edit on Makefile.
		const toolType = isToolCallEventType("write", event)
			? "write"
			: isToolCallEventType("edit", event)
				? "edit"
				: null;

		if (!toolType) return;

		const filePath = event.input.path;
		if (!filePath) return;

		// Block any modification to Makefile — it defines the project's validation contract.
		if (baseName(filePath).toLowerCase() === MAKEFILE_NAME) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`✋ Cannot modify Makefile — ask the user to change it if needed.`,
					"warning",
				);
			}
			return {
				block: true,
				reason:
					`Cannot ${toolType} "${filePath}" — the Makefile defines the project's ` +
					`validation contract and should only be changed intentionally by the user. ` +
					`If the Makefile really needs to change, tell the user what change is needed ` +
					`and why, and ask them to make it.`,
			};
		}

		// For write tool only: guard against overwrites of large existing files.
		if (toolType !== "write") return;

		const absolute = resolve(ctx.cwd, filePath);
		if (!existsSync(absolute)) return; // new file — allow

		let lineCount: number;
		try {
			const content = readFileSync(absolute, "utf-8");
			lineCount = content.split("\n").length;
		} catch {
			return; // can't read — let write proceed
		}

		if (lineCount <= MAX_LINES) return; // small file — allow

		if (ctx.hasUI) {
			ctx.ui.notify(
				`✋ Blocked overwrite of ${filePath} (${lineCount} lines). Use edit instead.`,
				"warning",
			);
		}

		return {
			block: true,
			reason:
				`Cannot overwrite "${filePath}" — it has ${lineCount} lines (threshold: ${MAX_LINES}). ` +
				`Use the \`edit\` tool to make surgical changes instead. ` +
				`The \`write\` tool on large existing files risks silently dropping content.`,
		};
	});
}
