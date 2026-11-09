import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { coreUrl } from "../../orca-plugin/core-link.ts";
import { STAGED_DIR, stageCore, unstageCore } from "./stage.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));

// An installed tree as the release lays it out: no .git, the source core beside the folder unstaged.
function installedTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-stage-"));
  for (const p of ["core", "orca-plugin", "package.json"]) cpSync(join(repo, p), join(dir, p), { recursive: true });
  rmSync(join(dir, "orca-plugin", STAGED_DIR), { recursive: true, force: true });
  return dir;
}

test("stageCore copies the core without tests and package.json into the folder, and core-link loads that copy", async () => {
  const dir = installedTree();
  try {
    await stageCore(dir);
    const staged = join(dir, "orca-plugin", STAGED_DIR);
    const files = readdirSync(join(staged, "core"), { recursive: true, encoding: "utf8" });
    assert.ok(files.includes("index.ts"));
    assert.ok(files.includes(join("graph", "flows", "ship-change.toml")), "non-TypeScript files the core reads come too");
    assert.deepEqual(files.filter((f) => f.endsWith(".test.ts")), []);
    assert.equal(readFileSync(join(staged, "package.json"), "utf8"), readFileSync(join(repo, "package.json"), "utf8"));

    const url = coreUrl(pathToFileURL(join(dir, "orca-plugin", "core-link.ts")).href);
    assert.equal(url?.href, pathToFileURL(join(staged, "core", "index.ts")).href);
    const core = (await import(url?.href ?? "")) as Record<string, unknown>;
    assert.equal(typeof core.openMonitors, "function", "the staged copy imports on its own, package.json included");
    assert.equal(typeof core.openPanelCore, "function");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("stageCore replaces a stale copy, and unstageCore removes it", async () => {
  const dir = installedTree();
  try {
    await stageCore(dir);
    rmSync(join(dir, "core", "version.ts"));
    await stageCore(dir);
    assert.equal(existsSync(join(dir, "orca-plugin", STAGED_DIR, "core", "version.ts")), false);
    await unstageCore(dir);
    assert.equal(existsSync(join(dir, "orca-plugin", STAGED_DIR)), false);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
