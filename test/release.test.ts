import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const pkg = read("package.json");

test("the Claude Code plugin manifest carries package.json's version (decision 99)", () => {
  assert.equal(read("claude-plugin/.claude-plugin/plugin.json").version, pkg.version);
});

test("the Orca plugin manifest, once present, carries package.json's version", { skip: !existsSync(join(ROOT, "orca-plugin/orca-plugin.json")) }, () => {
  assert.equal(read("orca-plugin/orca-plugin.json").version, pkg.version);
});

test("the marketplace lists sangsoe from ./claude-plugin, the name install and doctor use", () => {
  const m = read(".claude-plugin/marketplace.json");
  assert.equal(m.name, "sangsoe");
  assert.deepEqual(
    m.plugins.map((p: { name: string; source: string }) => [p.name, p.source]),
    [["sangsoe", "./claude-plugin"]],
  );
});

test("the release tarball's file list carries the build, both plugins and the marketplace", () => {
  for (const want of ["dist/", ".claude-plugin/", "claude-plugin/", "orca-plugin/", "build-info.json"]) {
    assert.ok(pkg.files.includes(want), `package.json files lacks ${want}`);
  }
});
