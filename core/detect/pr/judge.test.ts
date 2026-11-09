import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWatch } from "./config.ts";
import { classifyMain, itemStateOf, type MainRun, requestedTier } from "./judge.ts";

const NOW = 10_000_000;
const GRACE = 20 * 60_000;
const run = (p: Partial<MainRun>): MainRun => ({ id: 1, run_attempt: 1, status: "completed", conclusion: "success", updatedAt: NOW, jobs: 3, ...p });
const kind = (runs: MainRun[], now = NOW) => classifyMain(runs, now, GRACE).kind;

test("main CI: green, red on a rerun, first-attempt failure is suspect until the grace ends", () => {
  assert.equal(kind([run({})]), "green");
  assert.equal(kind([]), "pending", "no push run yet");
  assert.equal(kind([run({ status: "in_progress", conclusion: null })]), "pending");
  assert.equal(kind([run({ conclusion: "failure" })]), "suspect", "one rerun separates a flake");
  assert.equal(kind([run({ conclusion: "failure", run_attempt: 2 })]), "red", "the rerun failed too");
  assert.equal(kind([run({ conclusion: "success", run_attempt: 2 })]), "green", "the rerun passed: a flake");
  assert.equal(kind([run({ conclusion: "failure" })], NOW + GRACE), "red", "nobody reran within the grace");
});

test("main CI: a cancelled run is not red, a 0-job failure is unknown (GitHub outage)", () => {
  assert.equal(kind([run({ conclusion: "cancelled" })]), "unknown");
  assert.equal(kind([run({ id: 1, conclusion: "cancelled" }), run({ id: 2 })]), "green");
  const outage = classifyMain([run({ conclusion: "failure", jobs: 0 })], NOW + GRACE, GRACE);
  assert.deepEqual(outage, { kind: "unknown", why: "run 1 failed with 0 jobs" });
  assert.equal(kind([run({ conclusion: "failure", jobs: null })]), "unknown", "jobs unread: no action");
  assert.equal(kind([run({ conclusion: "action_required" })]), "unknown");
});

test("item state, requested tier label and the watch setting", () => {
  assert.equal(itemStateOf("blocked"), "blocked");
  assert.equal(itemStateOf("dispatched"), "in_progress");
  assert.equal(itemStateOf("completed"), null);
  assert.equal(requestedTier(["bug", "verify-tier:1"]), "V1");
  assert.equal(requestedTier(["verify-tier:9"]), null);
  assert.deepEqual(parseWatch({ watch: { repos: ["Acme/API"] }, owners: ["Owner1"] }), {
    repos: ["acme/api"],
    authors: [],
    linkedOnly: true,
    owners: ["owner1"],
  });
  assert.equal(parseWatch({}), null, "no watch: nothing is read");
  assert.equal(parseWatch({ watch: { repos: "acme/api" } }), null);
});
