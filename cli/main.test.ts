import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { run } from "./main.ts";

const pkgVersion: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

test("--version prints the package.json version", () => {
  assert.deepEqual(run(["--version"]), { code: 0, out: `sangsoe ${pkgVersion}` });
});

test("an unknown command exits 2 with usage", () => {
  const r = run(["nope"]);
  assert.equal(r.code, 2);
  assert.match(r.out, /^usage:/);
});
