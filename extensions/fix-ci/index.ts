/**
 * fix-ci extension
 *
 * 1. `push_and_check_ci` tool — pushes code, polls GitHub checks until they
 *    finish, returns results with failure logs. Tracks fix cycles and tells
 *    the AI to stop after MAX_CYCLES attempts.
 *
 * 2. Blocks ALL manual `git push` in bash — the AI must use the tool instead.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  gitPush,
  getHeadSha,
  pollChecks,
  fetchFailureLogs,
  isFailure,
  findGitPushInText,
  findGitPushInScript,
  extractScriptPaths,
  type CheckResult,
  type FailureLog,
} from "./logic.ts";

const MAX_CYCLES = 3;

export default function (pi: ExtensionAPI) {
  let cycleCount = 0;

  // ── Tool: push_and_check_ci ───────────────────────────────────────────────
  pi.registerTool({
    name: "push_and_check_ci",
    label: "Push & Check CI",
    description:
      "Push the current branch to origin, then poll GitHub Actions checks " +
      "until they all finish. Returns the status of every check. For failures, " +
      "includes the last 200 lines of log output. " +
      "You MUST use this tool instead of running `git push` in bash. " +
      "After fixing CI failures, call this tool again to re-push and re-check.",
    parameters: Type.Object({}),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      cycleCount++;
      const cycle = cycleCount;

      // 1. Push
      onUpdate?.({
        content: [{ type: "text", text: "Pushing to origin…" }],
      });

      const pushResult = gitPush(cwd);

      // Pin all subsequent checks to the exact commit we just pushed, so we
      // never read a previous commit's stale (already-green) check results.
      const pushedSha = getHeadSha(cwd) ?? undefined;

      if (!pushResult.success) {
        cycleCount = 0;
        return {
          content: [
            {
              type: "text",
              text:
                `git push failed:\n\n\`\`\`\n${pushResult.output}\n\`\`\`\n\n` +
                `Fix the push error and try again.`,
            },
          ],
          details: { pushFailed: true, output: pushResult.output },
        };
      }

      // 2. Poll checks
      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Push succeeded. Polling CI (cycle ${cycle}/${MAX_CYCLES})…`,
          },
        ],
      });

      const pollResult = await pollChecks(
        cwd,
        signal,
        (status) => {
          onUpdate?.({ content: [{ type: "text", text: status }] });
        },
        pushedSha
      );

      if (pollResult.timedOut) {
        cycleCount = 0;
        return {
          content: [
            {
              type: "text",
              text:
                `Timed out after ~${Math.round((pollResult.polls * 30) / 60)} min ` +
                `waiting for checks on ${pollResult.mode}. ` +
                `Some checks are still running. Last status:\n\n` +
                formatChecks(pollResult.checks) +
                `\n\nStop here — tell the user CI timed out.`,
            },
          ],
          details: {
            checks: pollResult.checks,
            mode: pollResult.mode,
            timedOut: true,
          },
        };
      }

      // 3. Categorise
      const failures = pollResult.checks.filter((c) => isFailure(c.bucket));

      // ✅ All passed
      if (failures.length === 0) {
        cycleCount = 0;
        return {
          content: [
            {
              type: "text",
              text:
                `All ${pollResult.checks.length} checks passed for ${pollResult.mode}. ✅\n\n` +
                formatChecks(pollResult.checks) +
                `\n\nCI is green — you're done.`,
            },
          ],
          details: {
            checks: pollResult.checks,
            mode: pollResult.mode,
            allPassed: true,
          },
        };
      }

      // 4. Fetch failure logs
      onUpdate?.({
        content: [
          {
            type: "text",
            text: `${failures.length} check(s) failed. Fetching logs…`,
          },
        ],
      });

      const failureLogs = await fetchFailureLogs(failures, cwd, signal);
      const report = buildReport(
        pollResult.mode,
        pollResult.checks,
        failures,
        failureLogs
      );

      // 5. Cycle limit
      if (cycle >= MAX_CYCLES) {
        cycleCount = 0;
        return {
          content: [
            {
              type: "text",
              text:
                report +
                `\n\nThis was attempt ${cycle}/${MAX_CYCLES}. Stop here — ` +
                `tell the user you were unable to fix CI after ${MAX_CYCLES} attempts ` +
                `and show them the remaining failures.`,
            },
          ],
          details: {
            checks: pollResult.checks,
            mode: pollResult.mode,
            failureLogs,
            exhausted: true,
          },
        };
      }

      // 6. Return failures for the AI to fix
      return {
        content: [
          {
            type: "text",
            text:
              report +
              `\n\nThis is attempt ${cycle}/${MAX_CYCLES}. ` +
              `Fix these failures with minimal code changes. ` +
              `Do not modify workflow files unless the failure is clearly a workflow bug. ` +
              `Run relevant checks locally if possible to verify before committing. ` +
              `After committing your fix, call push_and_check_ci again.`,
          },
        ],
        details: {
          checks: pollResult.checks,
          mode: pollResult.mode,
          failureLogs,
          cycle,
        },
      };
    },
  });

  // ── Block all manual git push in bash ─────────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const cmd = event.input.command ?? "";

    // Check inline command
    const inlineHit = findGitPushInText(cmd);
    if (inlineHit) {
      return {
        block: true,
        reason:
          `git push is not allowed in bash. Use the push_and_check_ci tool instead. ` +
          `It pushes your code and automatically waits for CI checks to complete. ` +
          `Blocked command: ${inlineHit}`,
      };
    }

    // Check scripts being executed
    for (const scriptPath of extractScriptPaths(cmd)) {
      const scriptHit = findGitPushInScript(scriptPath, ctx.cwd);
      if (scriptHit) {
        return {
          block: true,
          reason:
            `Cannot execute "${scriptPath}" — it contains git push. ` +
            `Use the push_and_check_ci tool instead. ` +
            `Blocked line in script: ${scriptHit}`,
        };
      }
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatChecks(checks: CheckResult[]): string {
  return checks
    .map((c) => {
      const icon = isFailure(c.bucket)
        ? "❌"
        : c.bucket === "pass"
          ? "✅"
          : "⏭️";
      return `${icon} ${c.name}: ${c.state}`;
    })
    .join("\n");
}

function buildReport(
  mode: string,
  allChecks: CheckResult[],
  failures: CheckResult[],
  failureLogs: FailureLog[]
): string {
  const passed = allChecks.filter((c) => !isFailure(c.bucket));
  const lines: string[] = [];

  lines.push(`## CI Results for ${mode}`);
  lines.push("");
  lines.push(`**${failures.length} failed**, ${passed.length} passed`);
  lines.push("");

  if (passed.length > 0) {
    lines.push("### Passed");
    for (const c of passed) {
      lines.push(`- ✅ ${c.name}`);
    }
    lines.push("");
  }

  lines.push("### Failures");
  lines.push("");
  for (const fl of failureLogs) {
    lines.push(`#### ❌ ${fl.name}`);
    if (fl.link) {
      lines.push(`URL: ${fl.link}`);
    }
    lines.push("");
    if (fl.log) {
      lines.push("```");
      lines.push(fl.log);
      lines.push("```");
    } else {
      lines.push("_(no logs available)_");
    }
    lines.push("");
  }

  return lines.join("\n");
}
