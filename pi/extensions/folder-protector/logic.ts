/**
 * Logic for the folder-protector extension.
 *
 * Pure functions — no Pi imports allowed.
 */

/**
 * List of banned folder names. Any path whose segments contain one of these
 * folder names (as an exact segment match) is blocked from write/edit/bash.
 */
export const BANNED_FOLDERS: string[] = [
	".git",
	"node_modules",
	"target",
];

/** Normalize path separators and remove trailing slash. */
function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Check whether a file path falls within any of the banned folders.
 * Matches exact path segments — e.g. ".git" matches ".git/HEAD" but not
 * ".gitignore" or ".gittest".
 */
export function isPathInsideBannedFolder(path: string, bannedFolders: string[]): boolean {
	const normalized = normalizePath(path);
	const segments = normalized.split("/");
	for (const folder of bannedFolders) {
		if (segments.includes(folder)) return true;
	}
	return false;
}
