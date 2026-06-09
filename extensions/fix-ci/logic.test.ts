/**
 * logic.test.ts — tests for fix-ci helpers.
 *
 * Run with:   node logic.test.ts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
	isFailure,
	isGitPushLine,
	findGitPushInText,
	extractScriptPaths,
	mapCheckRun,
	mapStatusState,
	allSuitesComplete,
	detectProjects,
	hasUnpushedCommits,
	gitPush,
} from "./logic.ts";

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

const asyncTests: Array<() => Promise<void>> = [];

function test(name: string, fn: (() => void) | (() => Promise<void>)): void {
	const run = async () => {
		try {
			await fn();
			console.log(`  ✓  ${name}`);
			passed++;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`  ✗  ${name}\n       ${msg}`);
			failed++;
		}
	};
	asyncTests.push(run);
}

function suite(name: string, fn: () => void): void {
	asyncTests.push(async () => console.log(`\n${name}`));
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
		// Forms the old regex matcher missed:
		"git -C /tmp/repo push",
		"git -c user.name=x push",
		"GIT_DIR=.git git push",
		"env git push",
		"/usr/bin/git push origin main",
		"\\git push",
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
	test("bare git push", () => assert.ok(findGitPushInText("git push") !== null));

	test("push with remote and branch", () =>
		assert.ok(findGitPushInText("git push origin main") !== null));

	test("force push", () => assert.ok(findGitPushInText("git push --force") !== null));

	test("push in multi-line script", () => {
		const script = "#!/bin/bash\ngit add .\ngit commit -m 'wip'\ngit push";
		assert.ok(findGitPushInText(script) !== null);
	});

	test("push after && on same line", () =>
		assert.ok(findGitPushInText("git commit -m 'msg' && git push") !== null));

	test("push after ; on same line", () =>
		assert.ok(findGitPushInText("git add .; git push") !== null));

	test("returns the offending line trimmed", () => {
		const result = findGitPushInText("  git push origin main  ");
		assert.equal(result, "git push origin main");
	});
});

suite("findGitPushInText — not detected", () => {
	test("no push", () => assert.equal(findGitPushInText("git commit -m 'msg'"), null));

	test("commented-out push", () => assert.equal(findGitPushInText("# git push"), null));

	test("echo git push", () => assert.equal(findGitPushInText("echo git push"), null));

	test("git pull (not push)", () => assert.equal(findGitPushInText("git pull origin main"), null));
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
	test("completed/null → fail", () => assert.equal(mapCheckRun("completed", null).bucket, "fail"));
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
	test("success → pass", () => assert.equal(mapStatusState("success").bucket, "pass"));
	test("pending → pending", () =>
		assert.deepEqual(mapStatusState("pending"), {
			state: "PENDING",
			bucket: "pending",
		}));
	test("failure → fail", () => assert.equal(mapStatusState("failure").bucket, "fail"));
	test("error → fail", () => assert.equal(mapStatusState("error").bucket, "fail"));
});

// ---------------------------------------------------------------------------
// allSuitesComplete (registration-window guard)
// ---------------------------------------------------------------------------

suite("allSuitesComplete", () => {
	test("empty list → complete", () => assert.ok(allSuitesComplete([])));
	test("all completed → complete", () => assert.ok(allSuitesComplete(["completed", "completed"])));
	test("any queued → not complete", () => assert.ok(!allSuitesComplete(["completed", "queued"])));
	test("any in_progress → not complete", () => assert.ok(!allSuitesComplete(["in_progress"])));
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
			extractRunId("https://github.com/owner/repo/actions/runs/12345678/job/9999"),
			"12345678",
		);
	});

	test("URL without job suffix", () => {
		assert.equal(extractRunId("https://github.com/owner/repo/actions/runs/12345678"), "12345678");
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
	return `… (${lines.length - maxLines} lines trimmed) …\n` + lines.slice(-maxLines).join("\n");
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
		assert.deepEqual(extractScriptPaths("bash -x -e ./deploy.sh"), ["./deploy.sh"]));

	test("source form", () =>
		assert.deepEqual(extractScriptPaths("source ./setup.sh"), ["./setup.sh"]));

	test("dot form", () => assert.deepEqual(extractScriptPaths(". ./setup.sh"), ["./setup.sh"]));

	test("direct ./script", () => assert.deepEqual(extractScriptPaths("./build.sh"), ["./build.sh"]));

	test("bash -c inline → no paths", () =>
		assert.deepEqual(extractScriptPaths("bash -c 'git push'"), []));

	test("compound: multiple scripts", () =>
		assert.deepEqual(extractScriptPaths("bash a.sh && bash b.sh"), ["a.sh", "b.sh"]));
});

// ---------------------------------------------------------------------------
// detectProject
// ---------------------------------------------------------------------------

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

suite("detectProjects", () => {
	function withTempDir(files: string[], fn: (dir: string) => void) {
		const dir = mkdtempSync(join(tmpdir(), "fix-ci-test-"));
		try {
			for (const f of files) writeFileSync(join(dir, f), "");
			fn(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	test("Cargo.toml → rust", () =>
		withTempDir(["Cargo.toml"], (dir) => {
			const projects = detectProjects(dir);
			assert.equal(projects.length, 1);
			assert.equal(projects[0].name, "rust");
			assert.ok(projects[0].checks.includes("cargo check"));
			assert.ok(projects[0].checks.includes("cargo fmt --check"));
		}));

	test("package.json → node", () =>
		withTempDir(["package.json"], (dir) => {
			const projects = detectProjects(dir);
			assert.equal(projects.length, 1);
			assert.equal(projects[0].name, "node");
		}));

	test("go.mod → go", () =>
		withTempDir(["go.mod"], (dir) => {
			const projects = detectProjects(dir);
			assert.equal(projects.length, 1);
			assert.equal(projects[0].name, "go");
		}));

	test("pyproject.toml → python", () =>
		withTempDir(["pyproject.toml"], (dir) => {
			const projects = detectProjects(dir);
			assert.equal(projects.length, 1);
			assert.equal(projects[0].name, "python");
		}));

	test("empty dir → empty", () =>
		withTempDir([], (dir) => {
			assert.deepEqual(detectProjects(dir), []);
		}));

	test("Cargo.toml + package.json → both rust and node", () =>
		withTempDir(["Cargo.toml", "package.json"], (dir) => {
			const projects = detectProjects(dir);
			assert.equal(projects.length, 2);
			assert.equal(projects[0].name, "rust");
			assert.equal(projects[1].name, "node");
		}));

	test("all markers → all project types", () =>
		withTempDir(["Cargo.toml", "package.json", "go.mod", "pyproject.toml"], (dir) => {
			const projects = detectProjects(dir);
			assert.equal(projects.length, 4);
			const names = projects.map((p) => p.name);
			assert.ok(names.includes("rust"));
			assert.ok(names.includes("node"));
			assert.ok(names.includes("go"));
			assert.ok(names.includes("python"));
		}));
});

// ---------------------------------------------------------------------------
// hasUnpushedCommits
// ---------------------------------------------------------------------------

function git(cmd: string, cwd: string): string {
	return execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
}

function withGitRepos(
	fn: (local: string, remote: string) => void | Promise<void>,
): () => Promise<void> {
	return async () => {
		const base = mkdtempSync(join(tmpdir(), "push-test-"));
		const remotePath = join(base, "remote.git");
		const localPath = join(base, "local");
		try {
			// Create a bare "remote" and clone it.
			execSync(`git init --bare ${remotePath}`, { stdio: "pipe" });
			execSync(`git clone ${remotePath} ${localPath}`, { stdio: "pipe" });
			git("git config user.email test@test.com", localPath);
			git("git config user.name test", localPath);
			// Initial commit so main exists.
			writeFileSync(join(localPath, "init.txt"), "init");
			git("git add .", localPath);
			git("git commit -m init", localPath);
			git("git push", localPath);
			await fn(localPath, remotePath);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	};
}

suite("hasUnpushedCommits", () => {
	test(
		"returns false when branch is up to date",
		withGitRepos(async (local) => {
			const result = await hasUnpushedCommits(local);
			assert.equal(result, false);
		}),
	);

	test(
		"returns true when there are unpushed commits",
		withGitRepos(async (local) => {
			writeFileSync(join(local, "new.txt"), "new");
			git("git add .", local);
			git("git commit -m 'new file'", local);
			const result = await hasUnpushedCommits(local);
			assert.equal(result, true);
		}),
	);

	test(
		"returns true when branch doesn't exist on remote",
		withGitRepos(async (local) => {
			git("git checkout -b new-branch", local);
			writeFileSync(join(local, "branch.txt"), "branch");
			git("git add .", local);
			git("git commit -m 'branch commit'", local);
			const result = await hasUnpushedCommits(local);
			assert.equal(result, true);
		}),
	);

	test(
		"returns false after pushing new commits",
		withGitRepos(async (local) => {
			writeFileSync(join(local, "new.txt"), "new");
			git("git add .", local);
			git("git commit -m 'new file'", local);
			git("git push", local);
			const result = await hasUnpushedCommits(local);
			assert.equal(result, false);
		}),
	);
});

// ---------------------------------------------------------------------------
// gitPush
// ---------------------------------------------------------------------------

suite("gitPush", () => {
	test(
		"pushes commits on an already-tracked branch",
		withGitRepos(async (local) => {
			writeFileSync(join(local, "new.txt"), "new");
			git("git add .", local);
			git("git commit -m 'new file'", local);

			const result = await gitPush(local);
			assert.equal(result.success, true);
			assert.equal(await hasUnpushedCommits(local), false);
		}),
	);

	test(
		"pushes a brand-new branch with no upstream (sets upstream)",
		withGitRepos(async (local) => {
			git("git checkout -b feature/new", local);
			writeFileSync(join(local, "branch.txt"), "branch");
			git("git add .", local);
			git("git commit -m 'branch commit'", local);

			// No upstream is configured for this branch yet.
			const result = await gitPush(local);
			assert.equal(result.success, true, result.output);

			// Upstream is now set and there's nothing left to push.
			const upstream = git(
				"git rev-parse --abbrev-ref --symbolic-full-name @{u}",
				local,
			);
			assert.equal(upstream, "origin/feature/new");
			assert.equal(await hasUnpushedCommits(local), false);
		}),
	);
});

// ---------------------------------------------------------------------------
// Run all tests & summary
// ---------------------------------------------------------------------------

(async () => {
	for (const t of asyncTests) await t();
	console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
})();
