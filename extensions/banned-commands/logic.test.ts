/**
 * logic.test.ts — tests for the shared command matcher and banned commands.
 *
 * Run with:   node logic.test.ts
 */
import assert from "node:assert/strict";
import { leadingCommand, findCommandUse, BANNED_NAMES } from "./logic.ts";
import { isPythonCommand } from "../../lib/command-utils.ts";

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

function suite(name: string): void {
	console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// leadingCommand
// ---------------------------------------------------------------------------

suite("leadingCommand");
test("plain command", () => assert.equal(leadingCommand("cat file"), "cat"));
test("sudo wrapper", () => assert.equal(leadingCommand("sudo cat /etc/x"), "cat"));
test("env wrapper", () => assert.equal(leadingCommand("env python -c 'x'"), "python"));
test("env assignment prefix", () => assert.equal(leadingCommand("FOO=bar tee out"), "tee"));
test("absolute path basename", () => assert.equal(leadingCommand("/usr/bin/sed -i s/a/b/ f"), "sed"));
test("alias-busting backslash", () => assert.equal(leadingCommand("\\cat x"), "cat"));
test("empty segment → null", () => assert.equal(leadingCommand("   "), null));
test("argument is not the command", () => assert.equal(leadingCommand("grep cat file"), "grep"));

// ---------------------------------------------------------------------------
// findCommandUse — banned cat/tee/sed
// ---------------------------------------------------------------------------

suite("findCommandUse — banned commands");

const shouldBlock = [
	["cat file", "cat"],
	["sudo cat /etc/passwd", "cat"],
	["FOO=bar sed -i s/a/b/ f", "sed"],
	["build | tee out.txt", "tee"],
	["echo $(cat secret)", "cat"],
	["echo `cat secret`", "cat"],
	["/bin/cat x", "cat"],
	["\\cat x", "cat"],
	["ls && cat file", "cat"],
	["foo; sed -n 1p f", "sed"],
] as const;

for (const [cmd, expected] of shouldBlock) {
	test(`blocks: ${cmd}`, () => {
		const hit = findCommandUse(cmd, BANNED_NAMES);
		assert.ok(hit, `expected a hit for ${cmd}`);
		assert.equal(hit!.name, expected);
	});
}

const shouldPass = [
	"grep cat file", // cat is an argument
	"echo concatenate things",
	"category list", // different command
	"git diff",
	"echo 'tee'", // quoted literal, not a command
	"rg --files | head",
];

for (const cmd of shouldPass) {
	test(`allows: ${cmd}`, () => {
		assert.equal(findCommandUse(cmd, BANNED_NAMES), null);
	});
}

// ---------------------------------------------------------------------------
// findCommandUse — python detection
// ---------------------------------------------------------------------------

suite("findCommandUse — python");

const pythonBlocked = [
	"python -c 'print(1)'",
	"python3 script.py",
	"env python -c 'x'",
	"python <<EOF",
	"python3.12 thing.py",
	"PYTHONPATH=. python run.py",
	"/usr/bin/python2 old.py",
	"ls && python build.py",
];

for (const cmd of pythonBlocked) {
	test(`blocks: ${cmd}`, () => {
		assert.ok(findCommandUse(cmd, isPythonCommand), `expected a hit for ${cmd}`);
	});
}

const pythonAllowed = [
	"mypython run", // different command
	"echo python", // argument, not command
	"pythonize x", // different command
	"which python", // inspecting, not executing
];

for (const cmd of pythonAllowed) {
	test(`allows: ${cmd}`, () => {
		assert.equal(findCommandUse(cmd, isPythonCommand), null);
	});
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
