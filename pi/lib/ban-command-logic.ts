/**
 * ban-command-logic.ts — pure matching logic for command policy enforcement.
 *
 * No pi imports — importable from any extension's test or logic module.
 */
import { splitCommandSegments, commandInvocation } from "./command-utils.ts";
import { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse } from "./command-policy-types.ts";

export { CommandPolicyStatus, type CommandPolicyEntry, type CommandUse };

/**
 * Check whether a command use matches a policy entry.
 */
export function matchesEntry(use: CommandUse, entry: CommandPolicyEntry): boolean {
	const commandMatches =
		typeof entry.command === "string" ? use.name === entry.command.toLowerCase() : entry.command(use.name);
	if (!commandMatches) return false;
	if (!entry.subcommand) return true;
	// subcommand is a list of arrays — ANY matching sub-array is sufficient (OR semantics).
	return entry.subcommand.some((sub) =>
		sub.every((part, index) => use.args[index]?.toLowerCase() === part.toLowerCase()),
	);
}

/**
 * Check whether an arg matches a flag (exact or `flag=value` form).
 */
export function flagMatches(arg: string, flag: string): boolean {
	return arg === flag || arg.startsWith(`${flag}=`);
}

/**
 * Extract flag arguments from a command use, excluding `--`.
 */
export function commandFlags(use: CommandUse): string[] {
	return use.args.filter((arg) => arg.startsWith("-") && arg !== "--");
}

/**
 * Find the first banned flag present in a command use.
 */
export function findBannedFlag(use: CommandUse, entry: CommandPolicyEntry): string | null {
	for (const flag of entry.bannedFlags ?? []) {
		if (use.args.some((arg) => flagMatches(arg, flag))) return flag;
	}
	return null;
}

/**
 * Find the first flag in a command use that is not in the entry's allowed set.
 * Returns null when there is no allowedFlags restriction, or when all flags
 * are allowed.
 */
export function findDisallowedFlag(use: CommandUse, entry: CommandPolicyEntry): string | null {
	if (!entry.allowedFlags) return null;
	for (const flag of commandFlags(use)) {
		if (!entry.allowedFlags.some((allowed) => flagMatches(flag, allowed))) return flag;
	}
	return null;
}

/**
 * Extract all command uses from shell text.
 */
export function getCommandUses(text: string): CommandUse[] {
	const uses: CommandUse[] = [];
	for (const segment of splitCommandSegments(text)) {
		const invocation = commandInvocation(segment);
		if (!invocation) continue;
		uses.push({ ...invocation, segment: segment.trim() });
	}
	return uses;
}