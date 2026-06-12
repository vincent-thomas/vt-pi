/**
 * logic.ts — banned-command definitions for the banned-commands extension.
 *
 * Re-exports the shared command matcher so tests can import everything from
 * one module.
 */
export { findCommandUse, leadingCommand, splitCommandSegments } from "../../lib/command-utils.ts";

/**
 * Map of banned command name → the suggested alternative shown to the model.
 * Banned anywhere in a command, including inside pipelines and command
 * substitutions.
 */
export const BANNED_COMMANDS: Record<string, string> = {
	cat: "Use the `read` tool to view file contents.",
	tee: "Use the `write` or `edit` tool to write file contents.",
	sed: "Use the `edit` tool for find-and-replace edits.",
	awk: "Use the `read` tool with offset/limit parameters to read specific lines, or `bash` with simpler tools like `head`, `tail`, `wc`, or `grep`.",
};

export const BANNED_NAMES: ReadonlySet<string> = new Set(Object.keys(BANNED_COMMANDS));
