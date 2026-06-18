/**
 * command policy extension helpers.
 *
 * Creates an extension that allows only configured shell command invocations via
 * the bash tool. Rules can match commands, subcommands, and banned flags.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse } from "./command-policy-types.ts";
import { commandInvocation, splitCommandSegments } from "./command-utils.ts";

export { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse } from "./command-policy-types.ts";

function getCommandUses(text: string): CommandUse[] {
	const uses: CommandUse[] = [];
	for (const segment of splitCommandSegments(text)) {
		const invocation = commandInvocation(segment);
		if (!invocation) continue;
		uses.push({ ...invocation, segment: segment.trim() });
	}
	return uses;
}

function matchesEntry(use: CommandUse, entry: CommandPolicyEntry): boolean {
	const commandMatches =
		typeof entry.command === "string" ? use.name === entry.command.toLowerCase() : entry.command(use.name);
	if (!commandMatches) return false;
	if (!entry.subcommand) return true;
	return entry.subcommand.every((part, index) => use.args[index]?.toLowerCase() === part.toLowerCase());
}

function flagMatches(arg: string, flag: string): boolean {
	return arg === flag || arg.startsWith(`${flag}=`);
}

function commandFlags(use: CommandUse): string[] {
	return use.args.filter((arg) => arg.startsWith("-") && arg !== "--");
}

function findBannedFlag(use: CommandUse, entry: CommandPolicyEntry): string | null {
	for (const flag of entry.bannedFlags ?? []) {
		if (use.args.some((arg) => flagMatches(arg, flag))) return flag;
	}
	return null;
}

function findDisallowedFlag(use: CommandUse, entry: CommandPolicyEntry): string | null {
	if (!entry.allowedFlags) return null;
	for (const flag of commandFlags(use)) {
		if (!entry.allowedFlags.some((allowed) => flagMatches(flag, allowed))) return flag;
	}
	return null;
}

export interface CommandPolicyOptions {
	entries: CommandPolicyEntry[];
}

export function createCommandPolicyExtension(options: CommandPolicyOptions) {
	return function (pi: ExtensionAPI) {
		pi.on("tool_call", async (event, ctx) => {
			if (!isToolCallEventType("bash", event)) return;

			const command = event.input.command ?? "";
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
