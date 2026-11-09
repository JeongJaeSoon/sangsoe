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

for (const argv of [["install", "--help"], ["uninstall", "-h"], ["doctor", "--help"], ["--help"]]) {
  test(`${argv.join(" ")} prints usage and touches nothing`, async () => {
    const r = await run(argv, { host: touchless() });
    assert.equal(r.code, 0);
    assert.match(r.out, /^usage:/);
  });
}

for (const argv of [["install", "--bogus"], ["uninstall", "now"], ["doctor", "--online"]]) {
  test(`${argv.join(" ")} exits 2 and touches nothing`, async () => {
    const r = await run(argv, { host: touchless() });
    assert.equal(r.code, 2);
  });
}
