import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
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
  assert.match(r.out, /^ {2}version +print the sangsoe version$/m);
});
