import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveCommit } from "./ports.ts";

const SHA = "c".repeat(40);

function tree(): { root: string; plugin: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "sangsoe-resolve-"));
  const plugin = join(root, "orca-plugin");
  mkdirSync(plugin);
  writeFileSync(join(plugin, "orca-plugin.json"), "{}");
  return { root, plugin, done: () => rmSync(root, { recursive: true, force: true }) };
}

function git(cwd: string, ...args: string[]): string {
  const cfg = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"];
  return execFileSync("git", [...cfg, ...args], { cwd, encoding: "utf8" }).trim();
}

test("a release tree reads the commit from build-info.json beside the folder", async () => {
  const t = tree();
  try {
    writeFileSync(join(t.root, "build-info.json"), JSON.stringify({ commit: SHA }));
    assert.equal(await resolveCommit(t.plugin), SHA);
  } finally {
    t.done();
  }
});

test("a broken build-info.json gives no commit instead of throwing", async () => {
  const t = tree();
  try {
    writeFileSync(join(t.root, "build-info.json"), '{"commit":');
    assert.equal(await resolveCommit(t.plugin), null);
    rmSync(join(t.root, "build-info.json"));
    mkdirSync(join(t.root, "build-info.json"));
    assert.equal(await resolveCommit(t.plugin), null);
  } finally {
    t.done();
  }
});

test("a tracked checkout ignores a stale build-info.json beside it", async () => {
  const t = tree();
  try {
    git(t.root, "init", "-q");
    writeFileSync(join(t.root, ".gitignore"), "build-info.json\n");
    git(t.root, "add", ".");
    git(t.root, "commit", "-q", "-m", "x");
    writeFileSync(join(t.root, "build-info.json"), JSON.stringify({ commit: SHA }));
    assert.equal(await resolveCommit(t.plugin), git(t.root, "rev-parse", "HEAD"));
  } finally {
    t.done();
  }
});

test("a git repo that only contains the folder, ignored, gives no commit", async () => {
  const t = tree();
  try {
    git(t.root, "init", "-q");
    writeFileSync(join(t.root, ".gitignore"), "orca-plugin/\n");
    git(t.root, "add", ".gitignore");
    git(t.root, "commit", "-q", "-m", "x");
    assert.equal(await resolveCommit(t.plugin), null);
    writeFileSync(join(t.root, "build-info.json"), JSON.stringify({ commit: SHA }));
    assert.equal(await resolveCommit(t.plugin), SHA, "a Homebrew tree still reads its build-info.json");
  } finally {
    t.done();
  }
});

test("a clean checkout that tracks the folder gives its HEAD; a dirty one gives none", async () => {
  const t = tree();
  try {
    git(t.root, "init", "-q");
    git(t.root, "add", ".");
    git(t.root, "commit", "-q", "-m", "x");
    assert.equal(await resolveCommit(t.plugin), git(t.root, "rev-parse", "HEAD"));
    writeFileSync(join(t.plugin, "main.ts"), "");
    assert.equal(await resolveCommit(t.plugin), null);
  } finally {
    t.done();
  }
});
