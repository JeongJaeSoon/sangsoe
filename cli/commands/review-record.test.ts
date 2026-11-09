import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../main.ts";
import { reviewRecord } from "./review-record.ts";

const HEAD = "b".repeat(40);
const untouched = {
  exec: async () => assert.fail("must not call gh"),
  openStore: () => assert.fail("must not open the store"),
};

test("a missing flag is an invalid_input refusal and touches nothing", async () => {
  const r = await reviewRecord({ pr: "7", head: HEAD }, untouched);
  assert.deepEqual(r, {
    ok: false,
    refusal: {
      code: "invalid_input",
      reason: "missing --act-on, --reviewer",
      fix: "sangsoe review record --pr <N> --head <sha> --act-on <N> --reviewer <name> [--repo <owner/name>]",
    },
  });
});

test("a non-numeric PR or count is refused before GitHub is asked", async () => {
  const r = await reviewRecord({ pr: "x7", head: HEAD, "act-on": "0", reviewer: "codex" }, untouched);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.refusal.reason, /pr must be a PR number/);
  const negative = await reviewRecord({ pr: "-1", head: HEAD, "act-on": "0", reviewer: "codex" }, untouched);
  assert.equal(negative.ok ? "" : negative.refusal.code, "review_refused");
});

test("the router: --json gives the refusal object, an unknown flag or a dash-led value is a usage error", async () => {
  const missing = await run(["review", "record", "--pr", "7", "--head", HEAD, "--json"]);
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.out).code, "invalid_input");
  const nan = await run(["review", "record", "--pr=-1", "--head", HEAD, "--act-on", "0", "--reviewer", "codex", "--json"]);
  assert.deepEqual([nan.code, JSON.parse(nan.out).code], [1, "review_refused"]);
  assert.equal((await run(["review", "record", "--bogus", "x"])).code, 2);
  assert.equal((await run(["review", "record", "--pr", "-1"])).code, 2, "the router's rule for every command: a value starting with - needs --flag=value");
});
