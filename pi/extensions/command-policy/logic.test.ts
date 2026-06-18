/**
 * logic.test.ts — tests for command policy allow-list helpers.
 *
 * Run with:   node logic.test.ts
 */
import assert from "node:assert/strict";
import { CommandPolicyStatus } from "../../lib/command-policy-types.ts";
import { COMMAND_POLICY_ENTRIES } from "./logic.ts";
import {
	commandInvocation,
	findCommandUse,
	isAwkCommand,
	isPerlCommand,
	isPythonCommand,
	leadingCommand,
	splitCommandSegments,
} from "../../lib/command-utils.ts";

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

function commandNames(text: string): string[] {
	return splitCommandSegments(text)
		.map((segment) => commandInvocation(segment)?.name)
		.filter((name): name is string => Boolean(name));
}

suite("commandInvocation — executable resolution");
const invocationCases = [
	["cat file", "cat", ["file"]],
	["sudo cat /etc/x", "cat", ["/etc/x"]],
	["sudo -n -- cat /etc/x", "cat", ["/etc/x"]],
	["doas cat /etc/x", "cat", ["/etc/x"]],
	["env python -c 'x'", "python", ["-c", "'x'"]],
	["env -i FOO=bar python script.py", "python", ["script.py"]],
	["FOO=bar PYTHONPATH=. tee out", "tee", ["out"]],
	["/usr/bin/sed -i s/a/b/ f", "sed", ["-i", "s/a/b/", "f"]],
	["\\cat x", "cat", ["x"]],
	["command grep x file", "grep", ["x", "file"]],
	["builtin echo hi", "echo", ["hi"]],
	["nice -n 10 rg needle", "rg", ["needle"]],
	["time -p git status --short", "git", ["status", "--short"]],
] as const;

for (const [segment, name, args] of invocationCases) {
	test(`resolves: ${segment}`, () => {
		assert.deepEqual(commandInvocation(segment), { name, args });
	});
}

test("empty segment → null", () => assert.equal(commandInvocation("   "), null));
test("leadingCommand returns only executable name", () => assert.equal(leadingCommand("grep cat file"), "grep"));

test("arguments are not treated as commands", () => {
	assert.equal(findCommandUse("echo awk", isAwkCommand), null);
	assert.equal(findCommandUse("printf python", isPythonCommand), null);
	assert.equal(findCommandUse("echo 'grep'", new Set(["grep"])), null);
});

suite("splitCommandSegments — multi-command bash text");
const splitCases = [
	["ls && true && cat 'fdsafdsa'", ["ls", "true", "cat"]],
	["rg foo | head", ["rg", "head"]],
	["rg foo || fd bar", ["rg", "fd"]],
	["pwd; ls\nrg needle", ["pwd", "ls", "rg"]],
	["echo $(git status --short)", ["echo", "git"]],
	["echo `git status --short`", ["echo", "git"]],
	["(cd /tmp && ls)", ["cd", "ls"]],
	["cat < input > output", ["cat"]],
	["foo & bar", ["foo", "bar"]],
	["echo 'awk && python' && true", ["echo", "true"]],
	["echo \"grep | sed\"; pwd", ["echo", "pwd"]],
] as const;

for (const [text, expected] of splitCases) {
	test(`extracts commands from: ${text}`, () => {
		assert.deepEqual(commandNames(text), expected);
	});
}

test("findCommandUse scans every runnable segment", () => {
	const hit = findCommandUse("ls && true && cat 'fdsafdsa'", new Set(["cat"]));
	assert.deepEqual(hit, { name: "cat", segment: "cat 'fdsafdsa'" });
});

test("findCommandUse sees pipelines and command substitutions", () => {
	assert.equal(findCommandUse("rg foo | head", new Set(["head"]))?.name, "head");
	assert.equal(findCommandUse("echo $(git status --short)", new Set(["git"]))?.segment, "git status --short");
});

suite("language command predicates");
const predicateCases = [
	["python -c 'print(1)'", isPythonCommand, "python"],
	["python3.12 script.py", isPythonCommand, "python3.12"],
	["/usr/bin/python2 old.py", isPythonCommand, "python2"],
	["perl5.38 thing.pl", isPerlCommand, "perl5.38"],
	["gawk '{print}' file", isAwkCommand, "gawk"],
	["mawk '{print}' file", isAwkCommand, "mawk"],
] as const;

for (const [text, predicate, expected] of predicateCases) {
	test(`matches executable only: ${text}`, () => {
		assert.equal(findCommandUse(text, predicate)?.name, expected);
	});
}

const predicateNonMatches = [
	["echo python", isPythonCommand],
	["pythonize x", isPythonCommand],
	["echo perl", isPerlCommand],
	["perlbrew list", isPerlCommand],
	["echo awk", isAwkCommand],
	["awkward name", isAwkCommand],
] as const;

for (const [text, predicate] of predicateNonMatches) {
	test(`does not match argument/plain text: ${text}`, () => {
		assert.equal(findCommandUse(text, predicate), null);
	});
}

suite("COMMAND_POLICY_ENTRIES");
function findEntry(name: string) {
	return COMMAND_POLICY_ENTRIES.find((entry) => entry.name === name);
}

test("allows commands by exact command", () => {
	assert.equal(findEntry("rg")?.status, CommandPolicyStatus.Allowed);
	assert.equal(findEntry("rg")?.command, "rg");
	assert.equal(findEntry("fd")?.command, "fd");
	assert.equal(findEntry("jq")?.command, "jq");
});

test("allows git on a subcommand basis", () => {
	assert.deepEqual(findEntry("git status")?.subcommand, ["status"]);
	assert.deepEqual(findEntry("git diff")?.subcommand, ["diff"]);
	assert.deepEqual(findEntry("git commit")?.subcommand, ["commit"]);
});

test("can explicitly ban entries with model guidance", () => {
	assert.equal(findEntry("git config")?.status, CommandPolicyStatus.Banned);
	assert.match(findEntry("git config")?.description ?? "", /Do not inspect or modify Git configuration/);
	assert.equal(findEntry("grep")?.status, CommandPolicyStatus.Banned);
	assert.match(findEntry("grep")?.description ?? "", /Use rg/);
});

test("supports banned flags per entry", () => {
	assert.ok(findEntry("rm")?.bannedFlags?.includes("-rf"));
	assert.ok(findEntry("git checkout")?.bannedFlags?.includes("-b"));
});

test("supports allowed flags per allowed entry", () => {
	assert.ok(findEntry("git status")?.allowedFlags?.includes("--short"));
	assert.equal(findEntry("git status")?.bannedFlags, undefined);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
