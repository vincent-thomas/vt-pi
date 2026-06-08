/**
 * logic.test.ts — tests for git-branch-guard helpers.
 *
 * Run with plain Node (no framework, no build step required):
 *
 *   node logic.test.ts
 */
import assert from "node:assert/strict";
import {
  isForcePushLine,
  findForcePushInText,
  extractScriptPaths,
  isShellScript,
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
    const msg =
      err instanceof assert.AssertionError ? err.message : String(err);
    console.error(`  ✗  ${name}\n       ${msg}`);
    failed++;
  }
}

function suite(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ---------------------------------------------------------------------------
// isForcePushLine — blocked
// ---------------------------------------------------------------------------

suite("isForcePushLine — blocked (force push)", () => {
  const cases = [
    "git push --force",
    "git push -f",
    "git push origin main --force",
    "git push origin main -f",
    "git push --force origin main",
    "git push --force-with-lease",
    "git push --force-with-lease origin main",
    "git push origin main --force-with-lease",
    "git push --force-with-lease=origin/main",
    "sudo git push --force",
    "sudo -n git push -f",
  ];
  for (const c of cases) {
    test(JSON.stringify(c), () => assert.ok(isForcePushLine(c)));
  }
});

// ---------------------------------------------------------------------------
// isForcePushLine — allowed
// ---------------------------------------------------------------------------

suite("isForcePushLine — allowed (regular push or not git)", () => {
  const cases = [
    "git push",
    "git push origin main",
    "git push origin HEAD",
    "git push --set-upstream origin feature",
    "git push -u origin feature",
    "echo git push --force", // not a real git command
    "git status",
    "git commit -m 'msg'",
    "git checkout main",
    "# git push --force", // comment (handled by findForcePushInText)
  ];
  for (const c of cases) {
    test(JSON.stringify(c), () => assert.ok(!isForcePushLine(c)));
  }
});

// ---------------------------------------------------------------------------
// findForcePushInText
// ---------------------------------------------------------------------------

suite("findForcePushInText — detected", () => {
  test("bare force push", () =>
    assert.ok(findForcePushInText("git push --force") !== null));

  test("force push with -f", () =>
    assert.ok(findForcePushInText("git push -f") !== null));

  test("force-with-lease", () =>
    assert.ok(findForcePushInText("git push --force-with-lease") !== null));

  test("force push in multi-line script", () => {
    const script =
      "#!/bin/bash\ngit add .\ngit commit -m 'wip'\ngit push --force";
    assert.ok(findForcePushInText(script) !== null);
  });

  test("force push after && on same line", () =>
    assert.ok(
      findForcePushInText("git commit -m 'msg' && git push --force") !== null
    ));

  test("force push after ; on same line", () =>
    assert.ok(findForcePushInText("git add .; git push -f") !== null));

  test("returns the offending line trimmed", () => {
    const result = findForcePushInText("  git push --force  ");
    assert.equal(result, "git push --force");
  });
});

suite("findForcePushInText — not detected", () => {
  test("regular push", () =>
    assert.equal(findForcePushInText("git push origin main"), null));

  test("commented-out force push", () =>
    assert.equal(findForcePushInText("# git push --force"), null));

  test("unrelated command", () =>
    assert.equal(findForcePushInText("cargo build --release"), null));

  test("regular push in multi-line script", () => {
    const script =
      "#!/bin/bash\ngit add .\ngit commit -m 'done'\ngit push origin main";
    assert.equal(findForcePushInText(script), null);
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

  test("sh with absolute path", () =>
    assert.deepEqual(extractScriptPaths("sh -e /tmp/run.sh"), [
      "/tmp/run.sh",
    ]));

  test("zsh script", () =>
    assert.deepEqual(extractScriptPaths("zsh build.sh"), ["build.sh"]));

  test("source form", () =>
    assert.deepEqual(extractScriptPaths("source ./setup.sh"), ["./setup.sh"]));

  test("dot form", () =>
    assert.deepEqual(extractScriptPaths(". ./setup.sh"), ["./setup.sh"]));

  test("direct ./script", () =>
    assert.deepEqual(extractScriptPaths("./build.sh"), ["./build.sh"]));

  test("absolute direct path", () =>
    assert.deepEqual(extractScriptPaths("/usr/local/bin/deploy"), [
      "/usr/local/bin/deploy",
    ]));

  test("bash -c inline → no paths returned", () =>
    assert.deepEqual(extractScriptPaths("bash -c 'git push --force'"), []));

  test("compound: echo && bash run.sh", () =>
    assert.deepEqual(extractScriptPaths("echo hi && bash run.sh"), [
      "run.sh",
    ]));

  test("compound: multiple scripts", () =>
    assert.deepEqual(extractScriptPaths("bash a.sh && bash b.sh"), [
      "a.sh",
      "b.sh",
    ]));
});

// ---------------------------------------------------------------------------
// isShellScript
// ---------------------------------------------------------------------------

suite("isShellScript", () => {
  test(".sh extension", () => assert.ok(isShellScript("deploy.sh", "")));

  test(".bash extension", () => assert.ok(isShellScript("setup.bash", "")));

  test(".zsh extension", () => assert.ok(isShellScript("run.zsh", "")));

  test("no extension but bash shebang", () =>
    assert.ok(isShellScript("Makefile-runner", "#!/bin/bash\necho hi")));

  test("no extension but env shebang", () =>
    assert.ok(isShellScript("run", "#!/usr/bin/env bash\necho hi")));

  test(".ts file → not a shell script", () =>
    assert.ok(!isShellScript("index.ts", "const x = 1;")));

  test("no extension, no shebang → not a shell script", () =>
    assert.ok(!isShellScript("README", "# Hello world")));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
