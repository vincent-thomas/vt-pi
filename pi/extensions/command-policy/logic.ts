/**
 * Command policy definitions for shell command allow rules.
 */

import { CommandPolicyStatus, type CommandPolicyEntry } from "../../lib/command-policy-types.ts";

export const COMMAND_POLICY_SYSTEM_PROMPT = `
Only run shell commands that are explicitly allowed by the command policy.
The policy can allow or ban commands by command, subcommand, and flag.
When a command is banned, follow the policy description for what to do instead.
Prefer Pi tools over shell commands when possible: use read for file contents,
write/edit for file changes, rg for search, and fd for file discovery.
`;

export const COMMAND_POLICY_ENTRIES: CommandPolicyEntry[] = [
	{ name: "sudo", status: CommandPolicyStatus.Banned, command: "sudo", description: "It is banned to try to gain superuser access" },
	{ name: "doas", status: CommandPolicyStatus.Banned, command: "doas", description: "It is banned to try to gain superuser access" },
	{ name: "cat", status: CommandPolicyStatus.Banned, command: "cat", description: "Use the read tool to view file contents." },
	{ name: "grep", status: CommandPolicyStatus.Banned, command: "grep", description: "Use rg for searching instead." },
	{ name: "find", status: CommandPolicyStatus.Banned, command: "find", description: "Use fd for file discovery instead." },
	{ name: "tee", status: CommandPolicyStatus.Banned, command: "tee", description: "Use the write or edit tool to write file contents." },
	{ name: "sed", status: CommandPolicyStatus.Banned, command: "sed", description: "Use the edit tool for find-and-replace edits." },
	{
		name: "Python",
		status: CommandPolicyStatus.Banned,
		command: (cmd: string): boolean => {
	    return /^python(?:\d+(?:\.\d+)?)?$/.test(cmd);
    },
		description: "Use safer shell tools or Pi tools instead. For JSON, prefer jq.",
	},
	{
		name: "Perl",
		status: CommandPolicyStatus.Banned,
		command: (cmd: string): boolean => {
	    return /^perl(?:\d+(?:\.\d+)?)?$/.test(cmd);
    },
		description: "Use safer shell tools or Pi tools instead. For JSON, prefer jq.",
	},
	{
		name: "awk",
		status: CommandPolicyStatus.Banned,
		command: (cmd: string): boolean => {
	    return /^(?:g|m|n)?awk$/.test(cmd);
    },
		description: "Use the read tool with offset/limit, or simpler tools like head, tail, wc, or rg.",
	},
	{ name: "ls", status: CommandPolicyStatus.Allowed, command: "ls" },
	{ name: "pwd", status: CommandPolicyStatus.Allowed, command: "pwd" },
	{ name: "echo", status: CommandPolicyStatus.Allowed, command: "echo" },
	{ name: "head", status: CommandPolicyStatus.Allowed, command: "head" },
	{ name: "tail", status: CommandPolicyStatus.Allowed, command: "tail" },
	{ name: "wc", status: CommandPolicyStatus.Allowed, command: "wc" },
	{ name: "sort", status: CommandPolicyStatus.Allowed, command: "sort" },
	{ name: "uniq", status: CommandPolicyStatus.Allowed, command: "uniq" },
	{ name: "xargs", status: CommandPolicyStatus.Allowed, command: "xargs" },
	{ name: "rg", status: CommandPolicyStatus.Allowed, command: "rg" },
	{ name: "fd", status: CommandPolicyStatus.Allowed, command: "fd" },
	{ name: "jq", status: CommandPolicyStatus.Allowed, command: "jq" },
	{ name: "true", status: CommandPolicyStatus.Allowed, command: "true" },
	{ name: "false", status: CommandPolicyStatus.Allowed, command: "false" },
	{ name: "test", status: CommandPolicyStatus.Allowed, command: "test" },
	{ name: "mkdir", status: CommandPolicyStatus.Allowed, command: "mkdir" },
	{ name: "rm", status: CommandPolicyStatus.Allowed, command: "rm", bannedFlags: ["-r", "-R", "-rf", "-fr", "--recursive"] },
	{ name: "cp", status: CommandPolicyStatus.Allowed, command: "cp", bannedFlags: ["-r", "-R", "--recursive"] },
	{ name: "mv", status: CommandPolicyStatus.Allowed, command: "mv" },
	{ name: "chmod", status: CommandPolicyStatus.Allowed, command: "chmod", bannedFlags: ["-R", "--recursive"] },
	{ name: "nix", status: CommandPolicyStatus.Allowed, command: "nix", subcommand: [["build"], ["flake", "check"], ["log"]] },
	{
		name: "git config",
		status: CommandPolicyStatus.Banned,
		command: "git",
		subcommand: [["config"]],
		description: "Do not inspect or modify Git configuration from Pi.",
	},
	{
		name: "git status",
		status: CommandPolicyStatus.Allowed,
		command: "git",
		subcommand: [["status"]],
		allowedFlags: ["--short", "--porcelain", "-s"],
	},
	{ name: "git", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [
    ["diff"],
    ["log"],
    ["show"],
    ["branch"],
    ["ls-files"],
    ["add"],
    ["restore"],
    ["rev-parse"],
    ["merge-base"],
    ["commit"],
    ["rm"]
  ] },
	{
		name: "git checkout",
		status: CommandPolicyStatus.Allowed,
		command: "git",
		subcommand: [["checkout"]],
		bannedFlags: ["-b", "-B", "--orphan"],
	},
];
