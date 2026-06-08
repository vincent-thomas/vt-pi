/**
 * index.ts — pi extension entry point for git-branch-guard.
 *
 * Intercepts force-push commands (git push --force / -f / --force-with-lease)
 * and requires explicit user confirmation before allowing them through.
 * Regular pushes are allowed without prompting.
 *
 * All testable logic lives in logic.ts (no pi imports there).
 * Run tests with:   node logic.test.ts
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import {
  findForcePushInText,
  findForcePushInScript,
  extractScriptPaths,
} from "./logic.ts";

export default function (pi: ExtensionAPI) {
  /**
   * Shows a yes/no confirm for a pending force push.
   * If the user says no, follows up with an optional "why?" input.
   * Returns { allowed: true } or { allowed: false, why?: string }.
   */
  async function askForcePushPermission(
    ctx: Parameters<Parameters<typeof pi.on>[1]>[1],
    description: string
  ): Promise<{ allowed: boolean; why?: string }> {
    const ok = await ctx.ui.confirm(
      "git force push — permission required",
      description
    );
    if (ok) return { allowed: true };
    const why = await ctx.ui.input(
      "Why not? (optional — press Enter to skip)",
      ""
    );
    return { allowed: false, why: why?.trim() || undefined };
  }

  // ── Intercept tool calls ──────────────────────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const cmd = event.input.command ?? "";

    // 1. Check inline command for force push
    const inlineHit = findForcePushInText(cmd);
    if (inlineHit) {
      const { allowed, why } = await askForcePushPermission(
        ctx,
        `Allow the following force push?\n\n  ${inlineHit.slice(0, 200)}`
      );
      if (!allowed) {
        ctx.ui.notify(
          "git-branch-guard: blocked force push — denied by user",
          "error"
        );
        return {
          block: true,
          reason:
            `git-branch-guard: Permission denied. The user declined the force push. ` +
            `Use a regular "git push" without --force or -f instead. ` +
            `Offending command: ${inlineHit}.` +
            (why ? ` Reason: ${why}` : ""),
        };
      }
      return; // User approved — let it through.
    }

    // 2. Check scripts being executed for force pushes
    for (const scriptPath of extractScriptPaths(cmd)) {
      const scriptHit = findForcePushInScript(scriptPath, ctx.cwd);
      if (scriptHit) {
        const { allowed, why } = await askForcePushPermission(
          ctx,
          `Allow execution of "${scriptPath}"?\n\nIt contains a force push:\n  ${scriptHit.slice(0, 200)}`
        );
        if (!allowed) {
          ctx.ui.notify(
            `git-branch-guard: blocked execution of "${scriptPath}" — force push denied by user`,
            "error"
          );
          return {
            block: true,
            reason:
              `git-branch-guard: Permission denied. The user declined the force push ` +
              `in "${scriptPath}" (offending line: ${scriptHit}). ` +
              `Use a regular "git push" without --force or -f instead.` +
              (why ? ` Reason: ${why}` : ""),
          };
        }
      }
    }
  });
}
