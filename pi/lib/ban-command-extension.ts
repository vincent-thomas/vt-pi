/**
 * command policy extension helpers.
 *
 * Creates an extension that allows only configured shell command invocations via
 * the bash tool. Rules can match commands, subcommands, and banned flags.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse } from "./command-policy-types.ts";
import { getCommandUses, matchesEntry, findBannedFlag, findDisallowedFlag } from "./ban-command-logic.ts";

export { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse } from "./command-policy-types.ts";
export { matchesEntry, flagMatches, commandFlags, findBannedFlag, findDisallowedFlag, getCommandUses } from "./ban-command-logic.ts";

export interface CommandPolicyOptions {
	entries: CommandPolicyEntry[];
}

/** Check if raw shell text contains `<<` outside of quotes. */
function hasHereDoc(text: string): boolean {
	let quote: "'" | '"' | null = null;
	let escape = false;
	for (let i = 0; i < text.length - 1; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (escape) { escape = false; continue; }
		if (ch === "\\") { escape = true; continue; }
		if (quote) { if (ch === quote) quote = null; continue; }
		if (ch === "'" || ch === '"') { quote = ch; continue; }
		// << or <<- outside quotes = here-doc
		if (ch === "<" && (next === "<" || (next === "<" && i + 2 < text.length && text[i + 2] === "-"))) {
			return true;
		}
	}
	return false;
}

export function createCommandPolicyExtension(options: CommandPolicyOptions) {
	return function (pi: ExtensionAPI) {
		pi.on("tool_call", async (event, ctx) => {
			if (!isToolCallEventType("bash", event)) return;

			const command = event.input.command ?? "";

			// Block here-docs entirely — they're not relevant for command policy.
			if (hasHereDoc(command)) {
				if (ctx.hasUI) ctx.ui.notify("🚫 Blocked here-doc (<<).", "warning");
				return {
					block: true,
					reason:
						`Here-docs (<<) are not allowed. ` +
						`Use inline input or other methods instead. ` +
						`Blocked: \`${command.trim()}\``,
				};
			}
			for (const use of getCommandUses(command)) {
				const entry = options.entries.find((candidate) => matchesEntry(use, candidate));
				if (!entry) {
					if (ctx.hasUI) ctx.ui.notify(`🚫 Blocked ${use.name}.`, "warning");
					return {
						block: true,
						reason: `Command is not on the allow list (blocked: \`${use.segment}\`).`,
					};
				}

				if (entry.status === CommandPolicyStatus.Banned) {
					if (ctx.hasUI) ctx.ui.notify(`🚫 Blocked ${entry.name}.`, "warning");
					return {
						block: true,
						reason: `${entry.name} is banned (blocked: \`${use.segment}\`). ${entry.description ?? ""}`,
					};
				}

				const bannedFlag = findBannedFlag(use, entry);
				if (bannedFlag) {
					if (ctx.hasUI) ctx.ui.notify(`🚫 Blocked ${entry.name} flag ${bannedFlag}.`, "warning");
					return {
						block: true,
						reason: `Flag \`${bannedFlag}\` is not allowed for ${entry.name} (blocked: \`${use.segment}\`). ${entry.description ?? ""}`,
					};
				}

				const disallowedFlag = findDisallowedFlag(use, entry);
				if (disallowedFlag) {
					if (ctx.hasUI) ctx.ui.notify(`🚫 Blocked ${entry.name} flag ${disallowedFlag}.`, "warning");
					return {
						block: true,
						reason:
							`Flag \`${disallowedFlag}\` is not in the allowed flags for ${entry.name} ` +
							`(blocked: \`${use.segment}\`). Allowed flags: ${entry.allowedFlags?.join(", ")}. ` +
							`${entry.description ?? ""}`,
					};
				}

				const validationError = entry.validate?.(use);
				if (validationError) {
					if (ctx.hasUI) ctx.ui.notify(`🚫 Blocked ${entry.name}.`, "warning");
					return {
						block: true,
						reason: `${entry.name} is not allowed here (blocked: \`${use.segment}\`). ${validationError}`,
					};
				}
			}
		});
	};
}
