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

// U46 finding 1: the packaging test proves expand in CI, but only the release job sees the tarball users get.
test("the release smoke expands both bundled flows from the packed tree with an empty HOME", () => {
  const yml = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
  const smoke = yml.split(/\n {6}- name: /).find((s) => s.startsWith("Smoke-test the packed tree"));
  assert.ok(smoke, "release.yml has no smoke step");
  for (const flow of ["ship-change", "ship-batch"]) {
    const line = smoke.split("\n").find((l) => l.includes(`--template ${flow}`));
    assert.ok(line, `smoke does not expand ${flow}`);
    assert.match(line, /HOME="\$\(mktemp -d\)"/, `${flow}: HOME is not an empty directory`);
    assert.match(line, /smoke\/package\/dist\/cli\/main\.js graph expand /, `${flow}: not run from the packed tree`);
    assert.match(line, /--dry-run/, `${flow}: would write to Orca`);
  }
  assert.match(smoke, /set -euo pipefail/, "a failed expand must fail the step");
});
