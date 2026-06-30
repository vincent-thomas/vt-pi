/**
 * git-utils.ts — shared helpers for extensions that intercept git commands.
 *
 * No pi imports — importable from any extension's logic module.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execAsync } from "./exec-async.ts";
import { commandInvocation, splitCommandSegments } from "./command-utils.ts";

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

/** Returns the current branch name, or null if not in a git repo. */
export function currentBranch(cwd: string): string | null {
	try {
		return (
			execSync("git branch --show-current", {
				cwd,
				stdio: ["pipe", "pipe", "pipe"],
			})
				.toString()
				.trim() || null
		);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Generic git command scanning
// ---------------------------------------------------------------------------

/**
 * Given a segment matcher, scan an arbitrary block of text for matching git
 * commands. Splitting (pipes, &&/||/;, command substitution, redirections,
 * newlines) and command resolution (env prefixes, sudo/env wrappers, absolute
 * paths) are handled by command-utils, so this sees through forms the old
 * regex matcher missed. Returns the first matching segment (trimmed), or null.
 */
export function findGitCommandInText(
	text: string,
	matcher: (segment: string) => boolean,
): string | null {
	for (const seg of splitCommandSegments(text)) {
		const trimmed = seg.trim();
		if (trimmed && matcher(trimmed)) return trimmed;
	}
	return null;
}

/**
 * Read a script file and scan it for a matching git command.
 */
export function findGitCommandInScript(
	scriptPath: string,
	cwd: string,
	matcher: (segment: string) => boolean,
): string | null {
	try {
		const abs = resolve(cwd, scriptPath);
		const content = readFileSync(abs, "utf8");
		return findGitCommandInText(content, matcher);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Subcommand matchers
// ---------------------------------------------------------------------------

// Git global options (before the subcommand) that consume the FOLLOWING token
// as their value, e.g. `git -C <path> push`, `git -c <name=value> commit`.
// These must be skipped so the real subcommand is found.
const GIT_VALUE_OPTS = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--exec-path",
	"--super-prefix",
	"--config-env",
]);

/**
 * Given the tokens that follow `git`, return the git subcommand (lowercased),
 * skipping git's global options. Returns null if no subcommand is present.
 */
function gitSubcommand(args: string[]): string | null {
	let i = 0;
	while (i < args.length) {
		const tok = args[i];
		if (tok.startsWith("-")) {
			// Value-taking option in separate form → also skip its value.
			i += GIT_VALUE_OPTS.has(tok) ? 2 : 1;
			continue;
		}
		return tok.toLowerCase();
	}
	return null;
}

/** Returns true if the segment invokes `git <sub>`, seeing through wrappers/prefixes. */
function isGitSubcommand(segment: string, sub: string): boolean {
	const inv = commandInvocation(segment);

	// Banned prefix commands (sudo, doas, …) are no longer stripped by
	// commandInvocation, so if the resolved command is one of those, find
	// "git" in the remaining args and check the subcommand that follows.
	if (inv?.name === "sudo" || inv?.name === "doas") {
		const gitIdx = inv.args.indexOf("git");
		if (gitIdx !== -1) {
			return gitSubcommand(inv.args.slice(gitIdx + 1)) === sub;
		}
		return false;
	}

	if (inv?.name === "git") {
		return gitSubcommand(inv.args) === sub;
	}
	return false;
}

/** Returns true if the segment is a `git push` invocation. */
export function isGitPushLine(segment: string): boolean {
	return isGitSubcommand(segment, "push");
}

/** Returns true if the segment is a `git commit` invocation. */
export function isGitCommitLine(segment: string): boolean {
	return isGitSubcommand(segment, "commit");
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

export function findGitPushInText(text: string): string | null {
	return findGitCommandInText(text, isGitPushLine);
}

export function findGitPushInScript(scriptPath: string, cwd: string): string | null {
	return findGitCommandInScript(scriptPath, cwd, isGitPushLine);
}

export function findGitCommitInText(text: string): string | null {
	return findGitCommandInText(text, isGitCommitLine);
}

export function findGitCommitInScript(scriptPath: string, cwd: string): string | null {
	return findGitCommandInScript(scriptPath, cwd, isGitCommitLine);
}

// ---------------------------------------------------------------------------
// Branch metadata
// ---------------------------------------------------------------------------

const DEFAULT_BRANCHES = new Set(["main", "master"]);

/** Returns true if `branch` is a default branch (main/master). */
export function isDefaultBranch(branch: string): boolean {
	return DEFAULT_BRANCHES.has(branch);
}

/**
 * Returns true if the current branch has an upstream tracking branch set.
 * Async — uses execAsync under the hood.
 */
export async function hasUpstream(cwd: string, signal?: AbortSignal): Promise<boolean> {
	try {
		await execAsync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
			cwd,
			timeout: 5_000,
			signal,
		});
		return true;
	} catch {
		// Non-zero exit means no upstream is configured for this branch.
		return false;
	}
}

// ---------------------------------------------------------------------------
// Script path extraction
// ---------------------------------------------------------------------------

/**
 * Extracts shell-script file paths that a bash command is about to execute.
 *
 * Handles:
 *   bash [-flags] script.sh      sh / zsh / ksh / dash too
 *   source file                  . file
 *   ./script.sh   /abs/script
 *
 * Does NOT extract from `bash -c '...'` — inline text is already scanned
 * by the text scanners above.
 */
export function extractScriptPaths(command: string): string[] {
	const paths: string[] = [];
	const segments = command.split(/[;&|]+/);

	for (const seg of segments) {
		const s = seg.trim();

		if (/^\s*(?:bash|sh|zsh|ksh|dash)\b.*\s-c\s/.test(s)) continue;

		const shellExecMatch = s.match(/^\s*(?:bash|sh|zsh|ksh|dash)\s+((?:-[a-zA-Z]+\s+)*)(\S+)/);
		if (shellExecMatch) {
			const candidate = shellExecMatch[2];
			if (!candidate.startsWith("-")) {
				paths.push(candidate);
				continue;
			}
		}

		const sourceMatch = s.match(/^\s*(?:source|\.)\s+(\S+)/);
		if (sourceMatch) {
			paths.push(sourceMatch[1]);
			continue;
		}

		const directMatch = s.match(/^\s*(\.\/\S+|\/\S+)/);
		if (directMatch) {
			paths.push(directMatch[1]);
		}
	}

	return paths;
}
