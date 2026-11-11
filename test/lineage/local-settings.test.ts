// Decision 202: what start_unit writes into a new worktree before its session starts, and that the
// file stays out of git so the reaper's clean-tree check still passes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LOCAL_SETTINGS, localSettingsJson, writeLocalSettings } from "../../core/index.ts";

test("the local settings carry the row's advisor, or the advisor's off switch, and nothing else", () => {
  assert.deepEqual(JSON.parse(localSettingsJson({ advisorModel: "a" })), { advisorModel: "a" });
  assert.deepEqual(JSON.parse(localSettingsJson({ disableAdvisor: true })), { env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" } });
  // A file a repo setup hook wrote keeps its own keys; only the advisor keys are sangsoe's.
  const base = { permissions: { allow: ["x"] }, advisorModel: "old", env: { A: "1", CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" } };
  assert.deepEqual(JSON.parse(localSettingsJson({ advisorModel: "a" }, base)), { permissions: { allow: ["x"] }, advisorModel: "a", env: { A: "1" } });
});

test("a path that is not a local git worktree throws and leaves nothing behind", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-local-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const plain = join(dir, "plain");
  mkdirSync(plain);
  const missing = join(dir, "remote", "host", "tree");
  for (const p of [plain, missing]) {
    assert.throws(() => writeLocalSettings(p, { advisorModel: "a" }));
  }
  assert.ok(!existsSync(join(plain, ".claude")), "no file in a plain folder");
  assert.ok(!existsSync(join(dir, "remote")), "no directories made for a path that is not here");
});

test("the file is written in the worktree and kept out of git status, in a linked worktree too", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-local-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A clean environment: no global excludes file may hide the result.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "no-global"), GIT_CONFIG_NOSYSTEM: "1", XDG_CONFIG_HOME: join(dir, "xdg") };
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env });
  const main = join(dir, "main");
  git(dir, "init", "-q", "-b", "main", main);
  git(main, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
  const linked = join(dir, "linked");
  git(main, "worktree", "add", "-q", "-b", "child", linked);
  const keys = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "XDG_CONFIG_HOME"] as const;
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) process.env[k] = env[k];
  try {
    writeLocalSettings(linked, { advisorModel: "a" });
    writeLocalSettings(linked, { disableAdvisor: true });
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
  assert.deepEqual(JSON.parse(readFileSync(join(linked, LOCAL_SETTINGS), "utf8")), { env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" } });
  assert.equal(git(linked, "status", "--porcelain=v1", "--untracked-files=all"), "", "the reaper sees a clean tree");
  const exclude = readFileSync(join(main, ".git", "info", "exclude"), "utf8");
  assert.equal(exclude.split("\n").filter((l) => l === `/${LOCAL_SETTINGS}`).length, 1, "added once, not per write");
});
