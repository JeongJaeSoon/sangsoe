// Decision 202: what start_unit writes into a new worktree before its session starts, and that the
// file stays out of git so the reaper's clean-tree check still passes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addParentReadRules, childReadRules, dropParentReadRules, LOCAL_SETTINGS, localSettingsJson, writeLocalSettings } from "../../core/index.ts";

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

test("a repository that commits the file is refused untouched, so start_unit falls back instead of making a diff", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-local-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, LOCAL_SETTINGS), "{}\n");
  git("add", "-f", LOCAL_SETTINGS);
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init");
  assert.throws(() => writeLocalSettings(repo, { advisorModel: "a" }), /tracked/);
  assert.equal(readFileSync(join(repo, LOCAL_SETTINGS), "utf8"), "{}\n");
  assert.equal(git("status", "--porcelain=v1"), "");
});

// Decision 310: the parent worktree's local settings let its session Read the child's worktree.

test("the child's Read rule is an absolute gitignore path, once more for a symlinked path, and refuses pattern characters", (t) => {
  assert.deepEqual(childReadRules("/home/dev/ws/feature-a/"), ["Read(//home/dev/ws/feature-a/**)"]);
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-local-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "real"));
  symlinkSync(join(dir, "real"), join(dir, "link"));
  assert.deepEqual(childReadRules(join(dir, "link")), [`Read(/${join(dir, "link")}/**)`, `Read(/${realpathSync(join(dir, "real"))}/**)`]);
  for (const bad of ["relative/tree", "/ws/a*b", "/ws/a(b)", "/ws/[x]", "/ws/!x", "/ws/a\\b"]) {
    assert.throws(() => childReadRules(bad), /plain absolute path/, bad);
  }
});

function parentWorktree(t: { after: (f: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-local-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "no-global"), GIT_CONFIG_NOSYSTEM: "1", XDG_CONFIG_HOME: join(dir, "xdg") };
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env });
  const main = join(dir, "main");
  git(dir, "init", "-q", "-b", "main", main);
  git(main, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init");
  const parent = join(dir, "parent");
  git(main, "worktree", "add", "-q", "-b", "lead", parent);
  // The code under test runs git too: no global excludes file may hide the file from it either.
  const keys = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "XDG_CONFIG_HOME"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) process.env[k] = env[k];
  t.after(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  return { dir, parent, git };
}

test("the parent's file gains the child's Read rule once, keeps every other key, and opens no write", (t) => {
  const { parent, git } = parentWorktree(t);
  // The owner's user settings are read-only to sangsoe: HOME is the test's throwaway folder.
  const user = join(homedir(), ".claude", "settings.json");
  mkdirSync(join(homedir(), ".claude"), { recursive: true });
  writeFileSync(user, '{"permissions":{"allow":["Bash(ls)"]}}\n');
  mkdirSync(join(parent, ".claude"));
  const before = { advisorModel: "fable", env: { A: "1" }, permissions: { allow: ["Bash(npm test)"], deny: ["Read(./.env)"] } };
  writeFileSync(join(parent, LOCAL_SETTINGS), JSON.stringify(before));
  const rules = childReadRules("/home/dev/ws/feature-a");
  addParentReadRules(parent, rules);
  addParentReadRules(parent, rules);
  const doc = JSON.parse(readFileSync(join(parent, LOCAL_SETTINGS), "utf8"));
  assert.deepEqual(doc, { ...before, permissions: { allow: ["Bash(npm test)", "Read(//home/dev/ws/feature-a/**)"], deny: ["Read(./.env)"] } });
  const all = JSON.stringify(doc.permissions);
  assert.ok(!/Edit\(|Write\(/.test(all) && !("additionalDirectories" in doc.permissions), "a read rule only");
  assert.equal(readFileSync(user, "utf8"), '{"permissions":{"allow":["Bash(ls)"]}}\n');
  assert.equal(git(parent, "status", "--porcelain=v1", "--untracked-files=all"), "", "kept out of git like decision 202's file");
  // A parent with no file yet gets one holding just the rule.
  const fresh = parentWorktree(t);
  addParentReadRules(fresh.parent, rules);
  assert.deepEqual(JSON.parse(readFileSync(join(fresh.parent, LOCAL_SETTINGS), "utf8")), { permissions: { allow: ["Read(//home/dev/ws/feature-a/**)"] } });
});

test("a parent that commits the file, or is not on this disk, is refused untouched", (t) => {
  const { parent, git } = parentWorktree(t);
  mkdirSync(join(parent, ".claude"));
  writeFileSync(join(parent, LOCAL_SETTINGS), "{}\n");
  git(parent, "add", "-f", LOCAL_SETTINGS);
  git(parent, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "commit it");
  assert.throws(() => addParentReadRules(parent, ["Read(//x/**)"]), /tracked/);
  assert.equal(readFileSync(join(parent, LOCAL_SETTINGS), "utf8"), "{}\n");
  assert.throws(() => addParentReadRules(join(parent, "..", "other-host", "tree"), ["Read(//x/**)"]));
});

test("taking the rule back removes exactly that string and nothing else", (t) => {
  const { parent } = parentWorktree(t);
  mkdirSync(join(parent, ".claude"));
  const mine = "Read(//home/dev/ws/feature-a/**)";
  const sibling = "Read(//home/dev/ws/feature-b/**)";
  writeFileSync(join(parent, LOCAL_SETTINGS), JSON.stringify({ advisorModel: "fable", permissions: { allow: ["Bash(npm test)", mine, sibling] } }));
  assert.equal(dropParentReadRules(parent, [mine]), true);
  assert.deepEqual(JSON.parse(readFileSync(join(parent, LOCAL_SETTINGS), "utf8")), { advisorModel: "fable", permissions: { allow: ["Bash(npm test)", sibling] } });
  assert.equal(dropParentReadRules(parent, [mine]), false, "already gone");
  assert.equal(dropParentReadRules(join(parent, "gone"), [mine]), false, "no file");
  writeFileSync(join(parent, LOCAL_SETTINGS), "not json");
  assert.equal(dropParentReadRules(parent, [mine]), false);
  assert.equal(readFileSync(join(parent, LOCAL_SETTINGS), "utf8"), "not json", "an unreadable file is left as it is");
});

test("a parent file whose permissions are not the shape Claude Code reads is refused untouched, not overwritten", (t) => {
  const { parent } = parentWorktree(t);
  mkdirSync(join(parent, ".claude"));
  for (const body of ['{"permissions":{"allow":"Bash(npm test)"}}', '{"permissions":["x"]}', '["x"]']) {
    writeFileSync(join(parent, LOCAL_SETTINGS), body);
    assert.throws(() => addParentReadRules(parent, ["Read(//x/**)"]), /not (an array|an object|a JSON object)/, body);
    assert.equal(dropParentReadRules(parent, ["Read(//x/**)"]), false, body);
    assert.equal(readFileSync(join(parent, LOCAL_SETTINGS), "utf8"), body);
  }
  // The write goes through a temporary file renamed over the old one: nothing else is left in .claude.
  writeFileSync(join(parent, LOCAL_SETTINGS), "{}");
  addParentReadRules(parent, ["Read(//x/**)"]);
  dropParentReadRules(parent, ["Read(//x/**)"]);
  assert.deepEqual(readdirSync(join(parent, ".claude")), ["settings.local.json"]);
});
