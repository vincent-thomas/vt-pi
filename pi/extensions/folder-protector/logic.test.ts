/**
 * logic.test.ts — tests for folder-protector logic.
 */
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import { isPathInsideBannedFolder, BANNED_FOLDERS } from "./logic.ts";

suite("isPathInsideBannedFolder with .git in BANNED_FOLDERS");

const isInsideDotGit = (path: string) => isPathInsideBannedFolder(path, BANNED_FOLDERS);

test("returns true for path directly inside .git", () => {
	assert.ok(isInsideDotGit(".git/HEAD"));
});

test("returns true for path inside .git subdirectory", () => {
	assert.ok(isInsideDotGit(".git/refs/heads/main"));
});

test("returns true for .git directory itself", () => {
	assert.ok(isInsideDotGit(".git"));
	assert.ok(isInsideDotGit(".git/"));
});

test("returns true for absolute paths inside .git", () => {
	assert.ok(isInsideDotGit("/home/user/repo/.git/config"));
});

test("returns false for non-.git paths", () => {
	assert.ok(!isInsideDotGit("src/index.ts"));
	assert.ok(!isInsideDotGit("README.md"));
	assert.ok(!isInsideDotGit("some/path/.gittest/file"));
});

test("returns false for paths containing .git as substring in a segment", () => {
	assert.ok(!isInsideDotGit("tools/gitignore/file"));
	assert.ok(!isInsideDotGit("src/.gitignore"));
	assert.ok(!isInsideDotGit(".gittest"));
});

test("returns false for empty string", () => {
	assert.ok(!isInsideDotGit(""));
});

suite("isPathInsideBannedFolder — custom folder lists");

test("matches any folder in a multi-folder list", () => {
	assert.ok(isPathInsideBannedFolder("node_modules/foo", [".git", "node_modules"]));
	assert.ok(isPathInsideBannedFolder("dist/out.js", ["dist"]));
});

test("does not match folders not in the list", () => {
	assert.ok(!isPathInsideBannedFolder("src/index.ts", [".git", "node_modules"]));
});

test("empty banned list returns false for everything", () => {
	assert.ok(!isPathInsideBannedFolder(".git/HEAD", []));
});
