/**
 * commit-enforcer/logic.test.ts — tests for git-state checking and message building.
 */
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import { buildNagMessage, MAX_ENFORCEMENTS } from "./logic.ts";

suite("buildNagMessage");

test("includes dirty-only issues", () => {
	const msg = buildNagMessage(true, false, 1, MAX_ENFORCEMENTS);
	assert.ok(msg.includes("uncommitted changes in the working tree"));
	assert.ok(!msg.includes("unpushed commits"));
	assert.ok(msg.includes("git_commit"));
	assert.ok(msg.includes("yield_with_uncommitted_changes"));
});

test("includes unpushed-only issues", () => {
	const msg = buildNagMessage(false, true, 1, MAX_ENFORCEMENTS);
	assert.ok(!msg.includes("uncommitted changes"));
	assert.ok(msg.includes("committed but unpushed commits"));
	assert.ok(msg.includes("push_and_check_ci"));
});

test("includes both issues", () => {
	const msg = buildNagMessage(true, true, 1, MAX_ENFORCEMENTS);
	assert.ok(msg.includes("uncommitted changes in the working tree"));
	assert.ok(msg.includes("committed but unpushed commits"));
});

test("shows escalation count", () => {
	const msg = buildNagMessage(true, false, 2, MAX_ENFORCEMENTS);
	assert.ok(msg.includes("Reminder 2/3"));
	assert.ok(msg.includes("1 more"));
});

test("omits escalation at or beyond max", () => {
	const atMax = buildNagMessage(true, false, MAX_ENFORCEMENTS, MAX_ENFORCEMENTS);
	assert.ok(!atMax.includes("Reminder"));

	const beyond = buildNagMessage(true, false, MAX_ENFORCEMENTS + 1, MAX_ENFORCEMENTS);
	assert.ok(!beyond.includes("Reminder"));
});

test("MAX_ENFORCEMENTS is 3", () => {
	assert.equal(MAX_ENFORCEMENTS, 3);
});