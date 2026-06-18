export const CommandPolicyStatus = {
	Allowed: "allowed",
	Banned: "banned",
} as const;

export type CommandPolicyStatus = (typeof CommandPolicyStatus)[keyof typeof CommandPolicyStatus];

export interface CommandUse {
	name: string;
	segment: string;
	args: string[];
}

type CommandPolicyEntryBase = {
	/** Display name for the entry, e.g. "git status" or "rg" */
	name: string;
	/** Executable basename or predicate to match, e.g. "git", "rg", or python variants */
	command: string | ((command: string) => boolean);
	/** Optional required leading args/subcommand, e.g. ["status"] for `git status` */
	subcommand?: string[];
	/** Guidance included when this entry blocks a command */
	description?: string;
};

export type BannedCommandPolicyEntry = CommandPolicyEntryBase & {
	status: typeof CommandPolicyStatus.Banned;
	bannedFlags?: never;
	allowedFlags?: never;
	validate?: never;
};

export type AllowedCommandPolicyEntry = CommandPolicyEntryBase & {
	status: typeof CommandPolicyStatus.Allowed;
	/** Flags that are forbidden when this entry matches. Mutually exclusive with allowedFlags. */
	bannedFlags?: string[];
	allowedFlags?: never;
	/** Optional extra validation for argument-sensitive allowed entries */
	validate?: (use: CommandUse) => string | null;
};

export type AllowedCommandPolicyEntryWithAllowedFlags = CommandPolicyEntryBase & {
	status: typeof CommandPolicyStatus.Allowed;
	bannedFlags?: never;
	/** The only flags allowed when this entry matches. Mutually exclusive with bannedFlags. */
	allowedFlags: string[];
	/** Optional extra validation for argument-sensitive allowed entries */
	validate?: (use: CommandUse) => string | null;
};

export type CommandPolicyEntry =
	| BannedCommandPolicyEntry
	| AllowedCommandPolicyEntry
	| AllowedCommandPolicyEntryWithAllowedFlags;
