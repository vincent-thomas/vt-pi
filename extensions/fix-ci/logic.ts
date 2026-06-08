/**
 * logic.ts — pure helpers for fix-ci (no pi imports).
 *
 * Handles git push, polling GitHub checks, and fetching failure logs via `gh`.
 *
 * Supports two check modes:
 *   - PR checks:     `gh pr checks <number>`
 *   - Commit checks: `gh run list --commit <sha>`
 *
 * `gh pr checks --json` fields: name, state, bucket, link, ...
 * `state` values: SUCCESS, FAILURE, PENDING, IN_PROGRESS, SKIPPED, etc.
 * `bucket` values: pass, fail, pending, skipping, cancel.
 */
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckResult {
  name: string;
  state: string;      // SUCCESS, FAILURE, PENDING, IN_PROGRESS, SKIPPED, etc.
  bucket: string;     // pass, fail, pending, skipping, cancel
  link: string | null;
}

export interface PollResult {
  checks: CheckResult[];
  timedOut: boolean;
  polls: number;
}

/** The SHA we pin all checks to, plus a human label for the report. */
export interface PollTarget {
  sha: string;
  mode: string;
}

export interface FailureLog {
  name: string;
  link: string | null;
  runId: string | null;
  log: string | null;
}

export interface PushResult {
  success: boolean;
  output: string;
}

// ---------------------------------------------------------------------------
// Git push
// ---------------------------------------------------------------------------

/**
 * Run `git push` and return the result.
 */
export function gitPush(cwd: string): PushResult {
  try {
    const output = execSync("git push 2>&1", {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    }).toString();
    return { success: true, output };
  } catch (err: unknown) {
    const output =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout: Buffer }).stdout)
        : err && typeof err === "object" && "stderr" in err
          ? String((err as { stderr: Buffer }).stderr)
          : String(err);
    return { success: false, output };
  }
}

// ---------------------------------------------------------------------------
// Check mode detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the current branch has an open PR.
 * Returns the PR number or null.
 */
export function detectPrNumber(cwd: string): number | null {
  try {
    const raw = execSync(
      "gh pr view --json number --jq '.number' 2>/dev/null",
      { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 }
    ).toString().trim();
    const num = parseInt(raw, 10);
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

/**
 * Get the HEAD commit SHA.
 */
export function getHeadSha(cwd: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    }).toString().trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const MAX_POLLS = 180;        // 180 × 30s = 90 minutes
const POLL_INTERVAL_MS = 30_000;

// When a commit has produced no checks at all, wait this many consecutive
// polls (with all check-suites settled) before concluding there genuinely are
// none — guards against the registration window right after a push.
const EMPTY_GRACE_POLLS = 4; // ~2 minutes

/** States that mean the check is still running. */
function isPending(state: string): boolean {
  return state === "PENDING" || state === "IN_PROGRESS";
}

/** Bucket values that mean the check failed. */
export function isFailure(bucket: string): boolean {
  return bucket === "fail" || bucket === "cancel";
}

/**
 * Map a GitHub check-run (status + conclusion) to our unified state/bucket.
 * Pure — exported for testing.
 */
export function mapCheckRun(
  status: string,
  conclusion: string | null
): { state: string; bucket: string } {
  if (status === "completed") {
    switch (conclusion) {
      case "success":
        return { state: "SUCCESS", bucket: "pass" };
      case "skipped":
      case "neutral":
        return { state: "SKIPPED", bucket: "skipping" };
      case "cancelled":
        return { state: "CANCELLED", bucket: "cancel" };
      default:
        // failure, timed_out, action_required, stale, null, …
        return { state: "FAILURE", bucket: "fail" };
    }
  }
  if (status === "in_progress") return { state: "IN_PROGRESS", bucket: "pending" };
  // queued, requested, waiting, pending
  return { state: "PENDING", bucket: "pending" };
}

/**
 * Map a commit-status state (Vercel etc.) to our unified state/bucket.
 * Pure — exported for testing.
 */
export function mapStatusState(
  state: string
): { state: string; bucket: string } {
  switch (state) {
    case "success":
      return { state: "SUCCESS", bucket: "pass" };
    case "pending":
      return { state: "PENDING", bucket: "pending" };
    default:
      // failure, error
      return { state: "FAILURE", bucket: "fail" };
  }
}

/**
 * Are all check-suites for the commit done being created/run?
 * If any suite is still queued/requested/in_progress, GitHub may yet add
 * more check-runs, so we must keep polling. Pure — exported for testing.
 */
export function allSuitesComplete(suiteStatuses: string[]): boolean {
  return suiteStatuses.every((s) => s === "completed");
}

/**
 * Resolve the SHA to pin checks to (the commit we just pushed) and a label.
 */
export function resolvePollTarget(cwd: string, pushedSha?: string): PollTarget {
  const sha = pushedSha || getHeadSha(cwd) || "";
  const pr = detectPrNumber(cwd);
  const mode = pr
    ? `PR #${pr} (${sha.slice(0, 8)})`
    : sha
      ? `commit ${sha.slice(0, 8)}`
      : "unknown";
  return { sha, mode };
}

/**
 * Poll checks until none are pending, or we hit the timeout.
 *
 * All checks are pinned to `pushedSha` (the commit just pushed). This avoids
 * the staleness bug where `gh pr checks` returns the *previous* commit's
 * already-green checks during the window before GitHub registers new runs.
 */
export async function pollChecks(
  cwd: string,
  signal?: AbortSignal,
  onStatus?: (msg: string) => void,
  pushedSha?: string
): Promise<PollResult & { mode: string }> {
  const { sha, mode } = resolvePollTarget(cwd, pushedSha);

  onStatus?.(`Checking CI for ${mode}…`);

  if (!sha) {
    return { checks: [], timedOut: false, polls: 0, mode };
  }

  let polls = 0;
  let emptyPolls = 0;

  while (polls < MAX_POLLS) {
    if (signal?.aborted) {
      return { checks: getChecksForSha(sha, cwd), timedOut: true, polls, mode };
    }

    polls++;
    const checks = getChecksForSha(sha, cwd);
    const suites = getSuiteStatuses(sha, cwd);
    const suitesComplete = allSuitesComplete(suites);

    const pending = checks.filter((c) => isPending(c.state)).length;
    const total = checks.length;

    if (total === 0) {
      // No checks yet for this exact commit. Either GitHub hasn't registered
      // them (wait) or there genuinely are none (conclude after a grace).
      if (suitesComplete) emptyPolls++;
      else emptyPolls = 0;

      if (suitesComplete && emptyPolls >= EMPTY_GRACE_POLLS) {
        onStatus?.(`No checks were registered for ${mode}.`);
        return { checks, timedOut: false, polls, mode };
      }
      onStatus?.(
        `Poll ${polls}: no checks registered yet for ${mode}, waiting…`
      );
    } else {
      emptyPolls = 0;
      if (pending === 0 && suitesComplete) {
        onStatus?.(`All ${total} checks finished for ${mode}.`);
        return { checks, timedOut: false, polls, mode };
      }
      const note = suitesComplete ? "" : " (suites still settling)";
      onStatus?.(
        `Poll ${polls}: ${total - pending}/${total} checks finished for ${mode}, ${pending} still running${note}…`
      );
    }

    await sleep(POLL_INTERVAL_MS, signal);
  }

  return { checks: getChecksForSha(sha, cwd), timedOut: true, polls, mode };
}

/**
 * Run a `gh api` call pinned to {owner}/{repo}, returning stdout or "".
 */
function ghApi(endpoint: string, jq: string, cwd: string): string {
  try {
    return execSync(
      `gh api --paginate "${endpoint}" --jq '${jq}'`,
      { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: 20_000 }
    ).toString();
  } catch {
    return "";
  }
}

/**
 * Fetch all checks for an exact commit SHA: GitHub Actions check-runs plus
 * commit statuses (Vercel, etc.), merged into one unified list.
 */
function getChecksForSha(sha: string, cwd: string): CheckResult[] {
  const results: CheckResult[] = [];

  // Check runs (GitHub Actions jobs).
  const runsTsv = ghApi(
    `repos/{owner}/{repo}/commits/${sha}/check-runs`,
    `.check_runs[] | [.name, .status, (.conclusion // ""), (.html_url // "")] | @tsv`,
    cwd
  );
  for (const line of runsTsv.split("\n")) {
    if (!line.trim()) continue;
    const [name, status, conclusion, url] = line.split("\t");
    const { state, bucket } = mapCheckRun(
      status ?? "queued",
      conclusion ? conclusion : null
    );
    results.push({
      name: name ?? "unknown",
      state,
      bucket,
      link: url ? url : null,
    });
  }

  // Commit statuses (non-Actions integrations like Vercel).
  const statusTsv = ghApi(
    `repos/{owner}/{repo}/commits/${sha}/status`,
    `.statuses[] | [.context, .state, (.target_url // "")] | @tsv`,
    cwd
  );
  for (const line of statusTsv.split("\n")) {
    if (!line.trim()) continue;
    const [name, state, url] = line.split("\t");
    const mapped = mapStatusState(state ?? "pending");
    results.push({
      name: name ?? "unknown",
      state: mapped.state,
      bucket: mapped.bucket,
      link: url ? url : null,
    });
  }

  return results;
}

/**
 * Fetch the status of every check-suite for a commit (queued / in_progress /
 * completed). Used to know whether GitHub is still creating check-runs.
 */
function getSuiteStatuses(sha: string, cwd: string): string[] {
  const raw = ghApi(
    `repos/{owner}/{repo}/commits/${sha}/check-suites`,
    `.check_suites[] | .status`,
    cwd
  );
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Failure log fetching
// ---------------------------------------------------------------------------

/**
 * For each failed check, extract the run ID from link and fetch logs.
 */
export async function fetchFailureLogs(
  failures: CheckResult[],
  cwd: string,
  signal?: AbortSignal
): Promise<FailureLog[]> {
  const results: FailureLog[] = [];
  const seenRunIds = new Set<string>();

  for (const check of failures) {
    if (signal?.aborted) break;

    const runId = extractRunId(check.link);

    if (runId && seenRunIds.has(runId)) {
      results.push({
        name: check.name,
        link: check.link,
        runId,
        log: "(see logs above — same workflow run)",
      });
      continue;
    }

    if (runId) seenRunIds.add(runId);

    const log = runId ? fetchRunLog(runId, cwd) : null;
    results.push({
      name: check.name,
      link: check.link,
      runId,
      log,
    });
  }

  return results;
}

/**
 * Extract the run ID from a GitHub Actions URL.
 */
function extractRunId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ?? null;
}

/**
 * Fetch failed logs for a run, falling back to full logs.
 */
function fetchRunLog(runId: string, cwd: string): string | null {
  try {
    const output = execSync(`gh run view ${runId} --log-failed 2>&1`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    }).toString();

    if (output.trim().length > 0) {
      return trimLog(output, 200);
    }
  } catch {
    // --log-failed may exit non-zero or produce nothing
  }

  try {
    const output = execSync(`gh run view ${runId} --log 2>&1`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    }).toString();

    return trimLog(output, 300);
  } catch {
    return null;
  }
}

/**
 * Keep the last N lines of log output.
 */
function trimLog(log: string, maxLines: number): string {
  const lines = log.split("\n");
  if (lines.length <= maxLines) return log;
  return (
    `… (${lines.length - maxLines} lines trimmed) …\n` +
    lines.slice(-maxLines).join("\n")
  );
}

// ---------------------------------------------------------------------------
// Git push detection (for blocking manual pushes)
// ---------------------------------------------------------------------------

/**
 * Returns true if a single command line is a `git push` invocation.
 */
export function isGitPushLine(line: string): boolean {
  if (!/^\s*(?:sudo\s+(?:-[a-zA-Z]\S*\s+)*)?git\s/.test(line)) return false;
  return /\bgit\s+push\b/.test(line);
}

/**
 * Scans text for any `git push` invocation.
 * Handles compound commands (&&, ||, ;) and skips comments.
 */
export function findGitPushInText(text: string): string | null {
  for (const rawLine of text.split("\n")) {
    for (const raw of rawLine.split(/&&|\|\||;/)) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (line.startsWith("#")) continue;
      if (isGitPushLine(line)) return line;
    }
  }
  return null;
}

/**
 * Reads a script file and returns the first git push line, or null.
 */
export function findGitPushInScript(
  scriptPath: string,
  cwd: string
): string | null {
  try {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const abs = resolve(cwd, scriptPath);
    const content = readFileSync(abs, "utf8");
    return findGitPushInText(content);
  } catch {
    return null;
  }
}

/**
 * Extracts shell-script file paths that a bash command is about to execute.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}
