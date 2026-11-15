import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Host } from "../core/index.ts";
import { run } from "./main.ts";

const pkgVersion: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

test("--version prints the package.json version", async () => {
  assert.deepEqual(await run(["--version"]), { code: 0, out: `sangsoe ${pkgVersion}` });
  assert.deepEqual(await run(["version"]), { code: 0, out: `sangsoe ${pkgVersion}` });
});

test("an unknown command exits 2 with usage", async () => {
  const r = await run(["nope"]);
  assert.equal(r.code, 2);
  assert.match(r.out, /^usage:/);
});

test("--help lists the collected commands", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^usage:/);
  for (const name of ["doctor", "install", "uninstall", "version"]) assert.match(r.out, new RegExp(`^ {2}${name} +\\S`, "m"));
});

// R-16: --help and unknown arguments leave the machine as it was.
const touchless = (): Host => ({
  run: () => assert.fail("must not run a command"),
  exists: () => assert.fail("must not read the tree"),
  readText: () => assert.fail("must not read the tree"),
  env: {},
  nodeVersion: "26.0.0",
});
const noChecks = () => assert.fail("must not build the start-check context");

for (const argv of [["install", "--help"], ["uninstall", "-h"], ["doctor", "--help"], ["plugin", "approve", "--help"], ["review", "record", "--help"], ["--help"]]) {
  test(`${argv.join(" ")} prints usage and touches nothing`, async () => {
    const r = await run(argv, { host: touchless(), checkContext: noChecks });
    assert.equal(r.code, 0);
    assert.match(r.out, /^usage:/);
  });
}

for (const argv of [["install", "--bogus"], ["uninstall", "now"], ["doctor", "--online"], ["plugin", "approve", "--bogus"], ["plugin", "approve", "--dir"]]) {
  test(`${argv.join(" ")} exits 2 and touches nothing`, async () => {
    const r = await run(argv, { host: touchless(), checkContext: noChecks });
    assert.equal(r.code, 2);
  });
}

// Decision 264: --auto-compact is its own step and takes only --yes.
for (const argv of [["install", "--auto-compact", "--permissions"], ["install", "--auto-compact", "--scope", "user"], ["install", "--auto-compact", "--stale-sessions"]]) {
  test(`${argv.join(" ")} is refused before anything is read or written`, async () => {
    const r = await run(argv, { host: touchless(), checkContext: noChecks });
    assert.equal(r.code, 1);
    assert.match(r.out, /\[invalid_input\]/);
  });
}

// Decision 221: the permissions flags are refused before anything is read or written.
for (const argv of [["install", "--yes"], ["install", "--scope", "user"], ["install", "--permissions", "--scope", "global"]]) {
  test(`${argv.join(" ")} is refused and touches nothing`, async () => {
    const r = await run(argv, { host: touchless(), checkContext: noChecks });
    assert.equal(r.code, 1);
    assert.match(r.out, /\[invalid_input\]\nfix: sangsoe install --permissions --scope user$/);
  });
}

test("doctor --offline reads the tree and builds no start-check context", async () => {
  const host = { ...touchless(), env: { SANGSOE_ROOT: "/fixture/tree" }, exists: () => false, readText: () => "" };
  const r = await run(["doctor", "--offline"], { host, checkContext: noChecks });
  assert.match(r.out, /^FAIL +tree: /);
});

// doctor and install reach Orca and gh only through the context the caller injects.
for (const argv of [["doctor"], ["install"]]) {
  test(`${argv.join(" ")} builds its start checks from the injected context`, async () => {
    const roots: string[] = [];
    const used = (root: string): never => {
      roots.push(root);
      throw new Error("injected context used");
    };
    const host = { ...touchless(), env: { SANGSOE_ROOT: "/fixture/tree" } };
    await assert.rejects(run(argv, { host, checkContext: used }), /injected context used/);
    assert.deepEqual(roots, ["/fixture/tree"]);
  });
}
