import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, reviewRecord } from "./review-record.ts";

const HEAD = "b".repeat(40);
const untouched = {
  exec: async () => assert.fail("must not call gh"),
  openStore: () => assert.fail("must not open the store"),
};

test("review record parses its four flags and defaults the repo", () => {
  assert.deepEqual(parseArgs(["--pr", "7", "--head", HEAD, "--act-on", "0", "--reviewer", "codex"]), {
    repo: "JeongJaeSoon/sangsoe",
    pr: 7,
    head: HEAD,
    actOn: 0,
    reviewer: "codex",
  });
  assert.equal((parseArgs(["--pr", "7", "--head", HEAD, "--act-on", "0", "--reviewer", "x", "--repo", "acme/api"]) as { repo: string }).repo, "acme/api");
});

test("help, a missing flag or an unknown one touch nothing", async () => {
  assert.equal((await reviewRecord(["--help"], untouched)).code, 0);
  const missing = await reviewRecord(["--pr", "7", "--head", HEAD], untouched);
  assert.equal(missing.code, 2);
  assert.match(missing.out, /missing --act-on, --reviewer/);
  assert.equal((await reviewRecord(["--pr", "7", "--bogus", "x"], untouched)).code, 2);
  assert.equal((await reviewRecord(["--pr"], untouched)).code, 2);
});

test("a non-numeric PR or count is refused before GitHub is asked", async () => {
  const r = await reviewRecord(["--pr", "x7", "--head", HEAD, "--act-on", "0", "--reviewer", "codex"], untouched);
  assert.equal(r.code, 1);
  assert.match(r.out, /pr must be a PR number/);
});
