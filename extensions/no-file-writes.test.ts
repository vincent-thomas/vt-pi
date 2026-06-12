/**
 * no-file-writes.test.ts — tests for blocking file write redirections
 */

import { test, suite } from "node:test";
import assert from "node:assert/strict";

// Inline the detection function for testing
function hasFileWriteRedirection(command: string): { found: boolean; segment?: string } {
	const pattern = /(\s|^)(>>?)\s+(?!\/dev\/|&[12]\b)(\S+)/g;
	const match = pattern.exec(command);
	
	if (match) {
		return {
			found: true,
			segment: match[0].trim(),
		};
	}
	
	return { found: false };
}

suite("no-file-writes — file write redirection detection");

const shouldBlock = [
	"echo 'content' >> file.txt",
	"printf 'data' > output.rs",
	"cat input.txt > output.txt",
	"ls -la > listing.txt",
	"echo foo >> /tmp/log.txt",
	"printf '\\ncode\\n' >> src/main.rs",
	"command arg1 arg2 > result.json",
	"FOO=bar echo test >> data.txt",
	"env echo x > file",
	"echo 'multi\nline' >> app.log",
];

for (const cmd of shouldBlock) {
	test(`blocks: ${cmd}`, () => {
		const result = hasFileWriteRedirection(cmd);
		assert.ok(result.found, `expected to block ${cmd}`);
		assert.ok(result.segment, `expected segment for ${cmd}`);
	});
}

const shouldPass = [
	"echo 'status message'",
	"printf 'debugging: %s' $VAR",
	"ls | grep foo",
	"cat file | wc -l",
	"echo test > /dev/null",
	"command 2> /dev/stderr",
	"build 1>&2",
	"test >&1",
	"grep pattern files",
	"echo concatenate things",
	"which printf",
	"man echo",
];

for (const cmd of shouldPass) {
	test(`allows: ${cmd}`, () => {
		const result = hasFileWriteRedirection(cmd);
		assert.equal(result.found, false, `should not block ${cmd}`);
	});
}
