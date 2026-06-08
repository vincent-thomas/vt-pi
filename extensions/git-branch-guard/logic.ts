/**
 * logic.ts — pure, pi-free helpers for git-branch-guard.
 *
 * No imports from @mariozechner/pi-coding-agent here so this file can be
 * tested directly with Node (no framework, no build step required):
 *
 *   node logic.test.ts
 */

// ---------------------------------------------------------------------------
// Force-push detection
// ---------------------------------------------------------------------------

/**
 * Returns true if a single (already whitespace-normalised) command line
 * is a `git push` invocation that includes --force or --force-with-lease.
 *
 * Blocked:
 *   git push --force
 *   git push -f
 *   git push --force-with-lease
 *   git push origin main --force
 *   git push origin main -f
 *   sudo git push --force
 *
 * Allowed (no force flag):
 *   git push
 *   git push origin main
 *   echo git push --force   (not actually a git command)
 */
export function isForcePushLine(line: string): boolean {
  // git must be the actual command, not inside an echo or comment.
  // Allow an optional leading "sudo [-flags]" prefix.
  if (!/^\s*(?:sudo\s+(?:-[a-zA-Z]\S*\s+)*)?git\s/.test(line)) return false;
  if (!/\bgit\s+push\b/.test(line)) return false;

  // Check for --force, -f, or --force-with-lease anywhere after "git push"
  const afterPush = line.replace(/.*\bgit\s+push\b/, "");
  // Match --force-with-lease (with optional =value), --force, or bare -f
  // (but not -f as part of a longer combined flag — git push doesn't use combined short flags,
  // but we check for standalone -f or -f at the end of a flags group)
  if (/\s--force-with-lease\b/.test(afterPush)) return true;
  if (/\s--force\b/.test(afterPush)) return true;
  // Match -f as a standalone flag (not part of a longer word)
  if (/\s-f\b/.test(afterPush)) return true;

  return false;
}

/**
 * Scans an arbitrary block of text (inline bash command or script file
 * content) for force-push git invocations.
 *
 * Handles both multi-line scripts and single-line compound commands joined
 * by &&, ||, or ;.  Skips comment lines.  Returns the first offending
 * line, or null if clean.
 */
export function findForcePushInText(text: string): string | null {
  for (const rawLine of text.split("\n")) {
    for (const raw of rawLine.split(/&&|\|\||;/)) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (line.startsWith("#")) continue;
      if (isForcePushLine(line)) return line;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shell-script detection
// ---------------------------------------------------------------------------

export const SHELL_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".ksh",
  ".dash",
]);

export const SHELL_SHEBANG_RE =
  /^#!\s*(?:\/usr\/bin\/env\s+|\/\S+\/)?(?:bash|sh|zsh|ksh|dash)\b/;

/** Returns true if the file path or content looks like a shell script. */
export function isShellScript(filePath: string, content: string): boolean {
  const ext = filePath.match(/(\.[^./\\]+)$/)?.[1]?.toLowerCase() ?? "";
  if (SHELL_EXTENSIONS.has(ext)) return true;
  const firstLine = content.split("\n")[0] ?? "";
  return SHELL_SHEBANG_RE.test(firstLine);
}

// ---------------------------------------------------------------------------
// Script path extraction from bash commands
// ---------------------------------------------------------------------------

/**
 * Extracts shell-script file paths that a bash command is about to execute.
 *
 * Handles:
 *   bash [-flags] script.sh      sh / zsh / ksh / dash too
 *   source file                  . file
 *   ./script.sh   /abs/script
 *
 * Does NOT extract from `bash -c '...'` — that inline text is already
 * scanned by findForcePushInText on the raw command string.
 */
export function extractScriptPaths(command: string): string[] {
  const paths: string[] = [];
  const segments = command.split(/[;&|]+/);

  for (const seg of segments) {
    const s = seg.trim();

    if (/^\s*(?:bash|sh|zsh|ksh|dash)\b.*\s-c\s/.test(s)) continue;

    const shellExecMatch = s.match(
      /^\s*(?:bash|sh|zsh|ksh|dash)\s+((?:-[a-zA-Z]+\s+)*)(\S+)/
    );
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

/**
 * Reads a script file (resolved relative to cwd) and returns the first
 * force-push line found inside it, or null if the file is clean / unreadable.
 */
export function findForcePushInScript(
  scriptPath: string,
  cwd: string
): string | null {
  try {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const abs = resolve(cwd, scriptPath);
    const content = readFileSync(abs, "utf8");
    return findForcePushInText(content);
  } catch {
    return null;
  }
}
