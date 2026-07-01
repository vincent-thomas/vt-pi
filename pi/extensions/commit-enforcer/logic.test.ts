/**
 * commit-enforcer/logic.test.ts — tests for git-state checking and message building.
 */
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import { buildNagMessage } from "./logic.ts";

suite("buildNagMessage");

test("includes dirty-only issues", () => {
	const msg = buildNagMessage(true, false);
	assert.ok(msg.includes("uncommitted changes in the working tree"));
	assert.ok(!msg.includes("unpushed commits"));
	assert.ok(msg.includes("git_commit"));
	assert.ok(msg.includes("yield_with_uncommitted_changes"));
});

test("includes unpushed-only issues", () => {
	const msg = buildNagMessage(false, true);
	assert.ok(!msg.includes("uncommitted changes"));
	assert.ok(msg.includes("committed but unpushed commits"));
	assert.ok(msg.includes("push_and_check_ci"));
});

test("includes both issues", () => {
	const msg = buildNagMessage(true, true);
	assert.ok(msg.includes("uncommitted changes in the working tree"));
	assert.ok(msg.includes("committed but unpushed commits"));
});
