/**
 * command-utils.ts — shared helpers for detecting specific command
 * invocations inside an arbitrary shell command string.
 *
 * No pi imports — importable from any extension's logic module.
 *
 * The goal is to find the *real* executable a shell segment runs, seeing
 * through environment-variable prefixes (`FOO=bar cmd`), command wrappers
 * (`sudo`, `env`, …), absolute paths (`/bin/cat`), alias-busting backslashes
 * (`\cat`), and to look inside pipelines and command substitutions.
 */

// `FOO=bar`, `PYTHONPATH=.` — a leading environment assignment, not a command.
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;

// Wrappers that delegate to a following command. We skip past these (and any
// option flags they carry) to reach the actual command being executed.
const WRAPPERS = new Set([
	"sudo",
	"env",
	"command",
	"exec",
	"nohup",
	"nice",
	"time",
	"builtin",
	"stdbuf",
	"setsid",
	"ionice",
	"doas",
]);

/**
 * Split a shell command line into the individual runnable segments. Splits on
 * sequence/pipe operators, newlines, subshell + command-substitution
 * boundaries, and redirections so the leading word of every runnable piece
 * can be inspected independently.
 *
 * Note: multi-char operators (`&&`, `||`, `$(`) are listed before their
 * single-char prefixes so they win the alternation.
 */
export function splitCommandSegments(text: string): string[] {
	return text.split(/&&|\|\||\$\(|[\n;|&()`<>{}]/);
}

/**
 * Resolve the actual command a single segment invokes: its executable name
 * (lowercased basename) plus the raw argument tokens that follow. Skips
 * leading environment assignments and command wrappers (sudo, env, …).
 * Returns null when the segment runs nothing.
 */
export function commandInvocation(segment: string): { name: string; args: string[] } | null {
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
	let i = 0;
	while (i < tokens.length) {
		let tok = tokens[i];
		if (tok.startsWith("\\")) tok = tok.slice(1); // `\cat` bypasses aliases
		if (ENV_ASSIGN.test(tok)) {
			i++;
			continue;
		}
		const base = (tok.split("/").pop() ?? tok).toLowerCase();
		if (base === "") {
			i++;
			continue;
		}
		if (WRAPPERS.has(base)) {
			i++;
			// Skip the wrapper's own option flags and inline assignments.
			while (i < tokens.length && (tokens[i].startsWith("-") || ENV_ASSIGN.test(tokens[i]))) {
				i++;
			}
			continue;
		}
		return { name: base, args: tokens.slice(i + 1) };
	}
	return null;
}

/**
 * Return the executable name (lowercased basename) that a single command
 * segment invokes. Returns null when the segment runs nothing.
 */
export function leadingCommand(segment: string): string | null {
	return commandInvocation(segment)?.name ?? null;
}

/**
 * Scan a shell command string for any invocation matching `match` (either a
 * set of command names or a predicate). Returns the matched command name and
 * the offending segment, or null.
 */
export function findCommandUse(
	text: string,
	match: ReadonlySet<string> | ((cmd: string) => boolean),
): { name: string; segment: string } | null {
	const test = typeof match === "function" ? match : (c: string) => match.has(c);
	for (const seg of splitCommandSegments(text)) {
		const cmd = leadingCommand(seg);
		if (cmd && test(cmd)) {
			return { name: cmd, segment: seg.trim() };
		}
	}
	return null;
}

/** Matches `python`, `python2`, `python3`, `python3.12`, etc. */
export function isPythonCommand(cmd: string): boolean {
	return /^python(?:\d+(?:\.\d+)?)?$/.test(cmd);
}
