/**
 * Logic for the git-guard extension.
 *
 * Pure functions — no Pi imports allowed.
 */

/** Normalize path separators and remove trailing slash. */
export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Check whether a file path is inside a .git directory (or is .git itself). */
export function isInsideDotGit(path: string): boolean {
	const normalized = normalizePath(path);
	// Check if any path segment is ".git"
	const segments = normalized.split("/");
	for (let i = 0; i < segments.length; i++) {
		if (segments[i] === ".git") return true;
	}
	return false;
}
