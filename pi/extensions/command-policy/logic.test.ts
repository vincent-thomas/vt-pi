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
import {
	matchesEntry,
	flagMatches,
	commandFlags,
	findBannedFlag,
	findDisallowedFlag,
	getCommandUses,
	type CommandUse,
} from "../../lib/ban-command-logic.ts";

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
	["sudo cat /etc/x", "sudo", ["cat", "/etc/x"]],
	["sudo -n -- cat /etc/x", "sudo", ["-n", "--", "cat", "/etc/x"]],
	["doas cat /etc/x", "doas", ["cat", "/etc/x"]],
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

suite("splitCommandSegments — edge cases");

const heredocCases = [
	// Here-doc body lines leak through — the parser doesn't track heredoc state.
	["cat << EOF\nhello\nEOF", ["cat", "hello", "eof"]],
	["cat << 'EOF'\nhello\nEOF", ["cat", "hello", "eof"]],
	["cat <<- EOF\n\thello\nEOF", ["cat", "eof", "hello", "eof"]],
	["cat << EOF\nhello\nEOF && ls", ["cat", "hello", "eof", "ls"]],
] as const;

for (const [text, expected] of heredocCases) {
	test(`here-doc body leaks: ${JSON.stringify(text.slice(0, 20))}...`, () => {
		assert.deepEqual(commandNames(text), expected);
	});
}

const redirectEdgeCases = [
	["cmd &> file", ["cmd"]],
	["cmd &>> file", ["cmd"]],
	["cmd |& grep foo", ["cmd", "grep"]],
	["echo foo >> file", ["echo"]],
	["cmd 2>&1", ["cmd"]],
	["cmd 2>&1 3>&2", ["cmd"]],
	["cmd 2>file", ["cmd"]],
	["cmd 1>>file", ["cmd"]],
	// Here-doc body leaks through even with an additional redirect.
	["cat << EOF > file\nhello\nEOF", ["cat", "hello", "eof"]],
	["cmd < input > output", ["cmd"]],
] as const;

for (const [text, expected] of redirectEdgeCases) {
	test(`redirect stripped: ${text}`, () => {
		assert.deepEqual(commandNames(text), expected);
	});
}

const complexCases = [
	// Nested command substitution: both echos and git are real commands.
	["echo $(echo $(git status))", ["echo", "echo", "git"]],
	// Backtick inside double quotes inside $() — echo cmd, backtick content not extracted.
	["echo $(echo \"`pwd`\")", ["echo", "echo"]],
	// Process substitution <(...) — inner commands are args, not extracted.
	["diff <(echo a) <(echo b)", ["diff"]],
] as const;

for (const [text, expected] of complexCases) {
	test(`complex extraction: ${JSON.stringify(text.slice(0, 30))}...`, () => {
		assert.deepEqual(commandNames(text), expected);
	});
}

suite("getCommandUses — command uses extraction");
test("extracts command uses with segment", () => {
	const uses = getCommandUses("git status --short && rg foo");
	assert.equal(uses.length, 2);
	assert.equal(uses[0].name, "git");
	assert.deepEqual(uses[0].args, ["status", "--short"]);
	assert.equal(uses[1].name, "rg");
	assert.deepEqual(uses[1].args, ["foo"]);
});

test("empty text produces no uses", () => {
	assert.deepEqual(getCommandUses(""), []);
});

test("text with only whitespace produces no uses", () => {
	assert.deepEqual(getCommandUses("   \n  "), []);
});

suite("flagMatches — flag comparison");
test("exact match", () => assert.ok(flagMatches("-rf", "-rf")));
test("starts with flag= form", () => assert.ok(flagMatches("--recursive=true", "--recursive")));
test("no match when different flag", () => assert.ok(!flagMatches("-rf", "-r")));

suite("commandFlags — flag extraction");
test("extracts flags only", () => {
	const use: CommandUse = { name: "git", args: ["status", "--short", "-b", "--", "file"], segment: "git status --short -b -- file" };
	assert.deepEqual(commandFlags(use), ["--short", "-b"]);
});

test("no flags returns empty", () => {
	const use: CommandUse = { name: "cat", args: ["file"], segment: "cat file" };
	assert.deepEqual(commandFlags(use), []);
});

test("-- alone is not a flag", () => {
	const use: CommandUse = { name: "git", args: ["--", "file"], segment: "git -- file" };
	assert.deepEqual(commandFlags(use), []);
});

suite("matchesEntry — command matching");
test("exact command name", () => {
	const use: CommandUse = { name: "rg", args: ["foo"], segment: "rg foo" };
	assert.ok(matchesEntry(use, { name: "rg", status: CommandPolicyStatus.Allowed, command: "rg" }));
});

test("predicate command match", () => {
	const use: CommandUse = { name: "python3", args: ["-c", "'x'"], segment: "python3 -c 'x'" };
	assert.ok(matchesEntry(use, { name: "Python", status: CommandPolicyStatus.Banned, command: (c: string) => /^python(?:\d+(?:\.\d+)?)?$/.test(c) }));
});

test("predicate does not match unrelated command", () => {
	const use: CommandUse = { name: "pythonize", args: [], segment: "pythonize" };
	assert.ok(!matchesEntry(use, { name: "Python", status: CommandPolicyStatus.Banned, command: (c: string) => /^python(?:\d+(?:\.\d+)?)?$/.test(c) }));
});

test("subcommand matches exact subcommand", () => {
	const use: CommandUse = { name: "git", args: ["status", "--short"], segment: "git status --short" };
	assert.ok(matchesEntry(use, { name: "git status", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["status"]], allowedFlags: ["--short"] }));
});

test("subcommand OR semantics matches any one sub-array", () => {
	const use: CommandUse = { name: "git", args: ["diff"], segment: "git diff" };
	assert.ok(matchesEntry(use, { name: "git", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["commit"], ["diff"], ["log"]] }));
});

test("subcommand no match when no sub-array fully matches", () => {
	const use: CommandUse = { name: "git", args: ["push"], segment: "git push" };
	assert.ok(!matchesEntry(use, { name: "git", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["commit"], ["diff"]] }));
});

test("subcommand matches when first arg matches one sub-array", () => {
	const use: CommandUse = { name: "git", args: ["config", "user.name"], segment: "git config user.name" };
	assert.ok(matchesEntry(use, { name: "git config", status: CommandPolicyStatus.Banned, command: "git", subcommand: [["config"], ["push"]] }));
});

test("no subcommand matches any args", () => {
	const use: CommandUse = { name: "git", args: ["anything"], segment: "git anything" };
	assert.ok(matchesEntry(use, { name: "git", status: CommandPolicyStatus.Allowed, command: "git" }));
});

test("command name is case-insensitive (use name is already lowercased by commandInvocation)", () => {
	const use: CommandUse = { name: "rg", args: ["foo"], segment: "rg foo" };
	assert.ok(matchesEntry(use, { name: "rg", status: CommandPolicyStatus.Allowed, command: "rg" }));
});

suite("findBannedFlag — flag bans");
test("detects banned flag in args", () => {
	const use: CommandUse = { name: "rm", args: ["-rf", "dir"], segment: "rm -rf dir" };
	assert.equal(findBannedFlag(use, { name: "rm", status: CommandPolicyStatus.Allowed, command: "rm", bannedFlags: ["-rf"] }), "-rf");
});

test("returns null when banned flag is absent", () => {
	const use: CommandUse = { name: "rm", args: ["file"], segment: "rm file" };
	assert.equal(findBannedFlag(use, { name: "rm", status: CommandPolicyStatus.Allowed, command: "rm", bannedFlags: ["-rf"] }), null);
});

test("flag=value form matches banned flag", () => {
	const use: CommandUse = { name: "git", args: ["checkout", "-b=feature"], segment: "git checkout -b=feature" };
	assert.equal(findBannedFlag(use, { name: "git checkout", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["checkout"]], bannedFlags: ["-b"] }), "-b");
});

test("bannedFlags empty list returns null", () => {
	const use: CommandUse = { name: "ls", args: ["-la"], segment: "ls -la" };
	assert.equal(findBannedFlag(use, { name: "ls", status: CommandPolicyStatus.Allowed, command: "ls", bannedFlags: [] }), null);
});

test("multiple banned flags returns first match", () => {
	const use: CommandUse = { name: "rm", args: ["-rf", "--recursive", "dir"], segment: "rm -rf --recursive dir" };
	assert.equal(findBannedFlag(use, { name: "rm", status: CommandPolicyStatus.Allowed, command: "rm", bannedFlags: ["-r", "-rf", "--recursive"] }), "-rf");
});

test("no bannedFlags on entry returns null", () => {
	const use: CommandUse = { name: "ls", args: ["-la"], segment: "ls -la" };
	assert.equal(findBannedFlag(use, { name: "ls", status: CommandPolicyStatus.Allowed, command: "ls" }), null);
});

suite("findDisallowedFlag — allowed flags enforcement");
test("detects flag outside allowed set", () => {
	const use: CommandUse = { name: "git", args: ["status", "-v"], segment: "git status -v" };
	assert.equal(findDisallowedFlag(use, { name: "git status", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["status"]], allowedFlags: ["--short", "--porcelain"] }), "-v");
});

test("passes when only allowed flags are present", () => {
	const use: CommandUse = { name: "git", args: ["status", "--short"], segment: "git status --short" };
	assert.equal(findDisallowedFlag(use, { name: "git status", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["status"]], allowedFlags: ["--short", "--porcelain"] }), null);
});

test("no allowedFlags on entry returns null", () => {
	const use: CommandUse = { name: "rg", args: ["foo"], segment: "rg foo" };
	assert.equal(findDisallowedFlag(use, { name: "rg", status: CommandPolicyStatus.Allowed, command: "rg" }), null);
});

test("allowed flag with =value form is accepted", () => {
	const use: CommandUse = { name: "git", args: ["status", "--porcelain=v1"], segment: "git status --porcelain=v1" };
	assert.equal(findDisallowedFlag(use, { name: "git status", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["status"]], allowedFlags: ["--porcelain"] }), null);
});

test("-- alone is not flagged even if not in allowed set", () => {
	const use: CommandUse = { name: "git", args: ["status", "--"], segment: "git status --" };
	assert.equal(findDisallowedFlag(use, { name: "git status", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["status"]], allowedFlags: ["--short"] }), null);
});

test("multiple flags first disallowed is reported", () => {
	const use: CommandUse = { name: "git", args: ["status", "-v", "-b"], segment: "git status -v -b" };
	assert.equal(findDisallowedFlag(use, { name: "git status", status: CommandPolicyStatus.Allowed, command: "git", subcommand: [["status"]], allowedFlags: ["--short"] }), "-v");
});

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
	assert.deepEqual(findEntry("git")?.subcommand, [
		["diff"], ["log"], ["show"], ["branch"],
		["ls-files"], ["add"], ["restore"],
		["rev-parse"], ["merge-base"], ["commit"], ["rm"],
	]);
	assert.deepEqual(findEntry("git status")?.subcommand, [["status"]]);
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
