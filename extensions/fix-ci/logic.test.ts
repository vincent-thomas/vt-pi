/**
 * logic.test.ts — tests for fix-ci helpers.
 *
 * Run with:   node logic.test.ts
 */
import assert from "node:assert/strict";
import {
  isFailure,
  isGitPushLine,
  findGitPushInText,
  extractScriptPaths,
  mapCheckRun,
  mapStatusState,
  allSuitesComplete,
} from "./logic.ts";

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗  ${name}\n       ${msg}`);
    failed++;
  }
}

function suite(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ---------------------------------------------------------------------------
// isGitPushLine — blocked
// ---------------------------------------------------------------------------

suite("isGitPushLine — blocked", () => {
  const cases = [
    "git push",
    "git push origin main",
    "git push origin HEAD",
    "git push --set-upstream origin feature",
    "git push -u origin feature",
    "git push --force",
    "git push -f",
    "git push --force-with-lease",
    "sudo git push",
    "sudo -n git push origin main",
  ];
  for (const c of cases) {
    test(JSON.stringify(c), () => assert.ok(isGitPushLine(c)));
  }
});

suite("isGitPushLine — allowed", () => {
  const cases = [
    "echo git push",
    "git status",
    "git commit -m 'msg'",
    "git pull origin main",
    "git fetch origin",
    "# git push",
  ];
  for (const c of cases) {
    test(JSON.stringify(c), () => assert.ok(!isGitPushLine(c)));
  }
});

// ---------------------------------------------------------------------------
// findGitPushInText
// ---------------------------------------------------------------------------

suite("findGitPushInText — detected", () => {
  test("bare git push", () =>
    assert.ok(findGitPushInText("git push") !== null));

  test("push with remote and branch", () =>
    assert.ok(findGitPushInText("git push origin main") !== null));

  test("force push", () =>
    assert.ok(findGitPushInText("git push --force") !== null));

  test("push in multi-line script", () => {
    const script = "#!/bin/bash\ngit add .\ngit commit -m 'wip'\ngit push";
    assert.ok(findGitPushInText(script) !== null);
  });

  test("push after && on same line", () =>
    assert.ok(
      findGitPushInText("git commit -m 'msg' && git push") !== null
    ));

  test("push after ; on same line", () =>
    assert.ok(findGitPushInText("git add .; git push") !== null));

  test("returns the offending line trimmed", () => {
    const result = findGitPushInText("  git push origin main  ");
    assert.equal(result, "git push origin main");
  });
});

suite("findGitPushInText — not detected", () => {
  test("no push", () =>
    assert.equal(findGitPushInText("git commit -m 'msg'"), null));

  test("commented-out push", () =>
    assert.equal(findGitPushInText("# git push"), null));

  test("echo git push", () =>
    assert.equal(findGitPushInText("echo git push"), null));

  test("git pull (not push)", () =>
    assert.equal(findGitPushInText("git pull origin main"), null));
});

// ---------------------------------------------------------------------------
// isFailure (bucket-based)
// ---------------------------------------------------------------------------

suite("isFailure", () => {
  test("fail bucket", () => assert.ok(isFailure("fail")));
  test("cancel bucket", () => assert.ok(isFailure("cancel")));
  test("pass bucket", () => assert.ok(!isFailure("pass")));
  test("pending bucket", () => assert.ok(!isFailure("pending")));
  test("skipping bucket", () => assert.ok(!isFailure("skipping")));
});

// ---------------------------------------------------------------------------
// mapCheckRun (SHA-pinned check-run mapping)
// ---------------------------------------------------------------------------

suite("mapCheckRun", () => {
  test("completed/success → pass", () =>
    assert.deepEqual(mapCheckRun("completed", "success"), {
      state: "SUCCESS",
      bucket: "pass",
    }));
  test("completed/failure → fail", () =>
    assert.equal(mapCheckRun("completed", "failure").bucket, "fail"));
  test("completed/timed_out → fail", () =>
    assert.equal(mapCheckRun("completed", "timed_out").bucket, "fail"));
  test("completed/null → fail", () =>
    assert.equal(mapCheckRun("completed", null).bucket, "fail"));
  test("completed/skipped → skipping", () =>
    assert.equal(mapCheckRun("completed", "skipped").bucket, "skipping"));
  test("completed/neutral → skipping", () =>
    assert.equal(mapCheckRun("completed", "neutral").bucket, "skipping"));
  test("completed/cancelled → cancel", () =>
    assert.equal(mapCheckRun("completed", "cancelled").bucket, "cancel"));
  test("queued → pending", () =>
    assert.deepEqual(mapCheckRun("queued", null), {
      state: "PENDING",
      bucket: "pending",
    }));
  test("in_progress → pending", () =>
    assert.deepEqual(mapCheckRun("in_progress", null), {
      state: "IN_PROGRESS",
      bucket: "pending",
    }));
});

// ---------------------------------------------------------------------------
// mapStatusState (commit-status mapping)
// ---------------------------------------------------------------------------

suite("mapStatusState", () => {
  test("success → pass", () =>
    assert.equal(mapStatusState("success").bucket, "pass"));
  test("pending → pending", () =>
    assert.deepEqual(mapStatusState("pending"), {
      state: "PENDING",
      bucket: "pending",
    }));
  test("failure → fail", () =>
    assert.equal(mapStatusState("failure").bucket, "fail"));
  test("error → fail", () =>
    assert.equal(mapStatusState("error").bucket, "fail"));
});

// ---------------------------------------------------------------------------
// allSuitesComplete (registration-window guard)
// ---------------------------------------------------------------------------

suite("allSuitesComplete", () => {
  test("empty list → complete", () =>
    assert.ok(allSuitesComplete([])));
  test("all completed → complete", () =>
    assert.ok(allSuitesComplete(["completed", "completed"])));
  test("any queued → not complete", () =>
    assert.ok(!allSuitesComplete(["completed", "queued"])));
  test("any in_progress → not complete", () =>
    assert.ok(!allSuitesComplete(["in_progress"])));
});

// ---------------------------------------------------------------------------
// extractRunId (mirrors private logic)
// ---------------------------------------------------------------------------

function extractRunId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ?? null;
}

suite("extractRunId", () => {
  test("standard GitHub Actions URL", () => {
    assert.equal(
      extractRunId(
        "https://github.com/owner/repo/actions/runs/12345678/job/9999"
      ),
      "12345678"
    );
  });

  test("URL without job suffix", () => {
    assert.equal(
      extractRunId("https://github.com/owner/repo/actions/runs/12345678"),
      "12345678"
    );
  });

  test("null URL", () => assert.equal(extractRunId(null), null));
  test("unrelated URL", () =>
    assert.equal(extractRunId("https://github.com/owner/repo/pull/42"), null));
  test("empty string", () => assert.equal(extractRunId(""), null));
});

// ---------------------------------------------------------------------------
// trimLog (mirrors private logic)
// ---------------------------------------------------------------------------

function trimLog(log: string, maxLines: number): string {
  const lines = log.split("\n");
  if (lines.length <= maxLines) return log;
  return (
    `… (${lines.length - maxLines} lines trimmed) …\n` +
    lines.slice(-maxLines).join("\n")
  );
}

suite("trimLog", () => {
  test("short log returned as-is", () => {
    const log = "line1\nline2\nline3";
    assert.equal(trimLog(log, 10), log);
  });

  test("long log is trimmed to last N lines", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
    const log = lines.join("\n");
    const result = trimLog(log, 200);
    assert.ok(result.startsWith("… (100 lines trimmed) …\n"));
    assert.ok(result.endsWith("line 300"));
    assert.equal(result.split("\n").length, 201);
  });

  test("exact boundary — no trimming", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const log = lines.join("\n");
    assert.equal(trimLog(log, 200), log);
  });
});

// ---------------------------------------------------------------------------
// extractScriptPaths
// ---------------------------------------------------------------------------

suite("extractScriptPaths", () => {
  test("bash script.sh", () =>
    assert.deepEqual(extractScriptPaths("bash script.sh"), ["script.sh"]));

  test("bash with flags", () =>
    assert.deepEqual(extractScriptPaths("bash -x -e ./deploy.sh"), [
      "./deploy.sh",
    ]));

  test("source form", () =>
    assert.deepEqual(extractScriptPaths("source ./setup.sh"), ["./setup.sh"]));

  test("dot form", () =>
    assert.deepEqual(extractScriptPaths(". ./setup.sh"), ["./setup.sh"]));

  test("direct ./script", () =>
    assert.deepEqual(extractScriptPaths("./build.sh"), ["./build.sh"]));

  test("bash -c inline → no paths", () =>
    assert.deepEqual(extractScriptPaths("bash -c 'git push'"), []));

  test("compound: multiple scripts", () =>
    assert.deepEqual(extractScriptPaths("bash a.sh && bash b.sh"), [
      "a.sh",
      "b.sh",
    ]));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
