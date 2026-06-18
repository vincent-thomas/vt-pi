import { test, suite } from "node:test";
import assert from "node:assert/strict";
import {
	checkSandboxBash,
	sandboxActiveToolNames,
	sandboxBlockReason,
} from "./logic.ts";

suite("sandbox — active tools");

test("keeps only read-only sandbox tools that are available", () => {
	assert.deepEqual(
		sandboxActiveToolNames(["read", "write", "bash", "edit", "ls", "push_and_check_ci"]),
		["read", "ls", "bash"],
	);
});

test("omits missing tools", () => {
	assert.deepEqual(sandboxActiveToolNames(["read", "write"]), ["read"]);
});

suite("sandbox — bash allow-list");

const shouldAllow = [
	"ls",
	"ls -la",
	"ls pi/extensions",
	"/bin/ls -la /tmp",
	"\\ls -lh .",
	"ls --color=auto src",
];

for (const command of shouldAllow) {
	test(`allows: ${command}`, () => {
		assert.equal(checkSandboxBash(command).allowed, true);
	});
}

const shouldBlock = [
	"",
	"pwd",
	"cat file.txt",
	"rg TODO",
	"ls | grep foo",
	"ls && rm -rf tmp",
	"ls; touch file",
	"ls > listing.txt",
	"ls $(touch file)",
	"ls `touch file`",
	"ls\ntouch file",
	"env ls",
];

for (const command of shouldBlock) {
	test(`blocks: ${JSON.stringify(command)}`, () => {
		const decision = checkSandboxBash(command);
		assert.equal(decision.allowed, false);
		assert.ok(decision.reason);
	});
}

test("block reason names the blocked tool", () => {
	assert.match(sandboxBlockReason("write"), /`write`/);
	assert.match(sandboxBlockReason("write"), /read-only/);
});
