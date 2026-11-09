import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../contract/index.ts";
import { evidenceGaps, mergedItemMark } from "./evidence.ts";

const PR = "acme/api#12";
const HEAD = "a".repeat(40);
let seq = 0;
const row = (type: string, payload: Record<string, unknown>, extra: Partial<StoredEvent> = {}): StoredEvent => ({
  seq: ++seq,
  ts: "2026-11-10T00:00:00Z",
  type,
  source: "test",
  target: null,
  subject: PR,
  entity: null,
  entity_id: null,
  actor: "worker:u1",
  needs: "none",
  severity: null,
  dedupe_key: null,
  schema_v: 1,
  before: null,
  payload,
  ...extra,
});
const ev = (kind: string, extra: Record<string, unknown> = {}, meta: Partial<StoredEvent> = {}) =>
  row("evidence", { kind, head_sha: HEAD, exit_code: 0, not_verified: ["prod"], ...extra }, meta);
const gaps = (events: StoredEvent[], kinds = ["test", "run"]) =>
  evidenceGaps(events, { pr: PR, head: HEAD, author: "alice", kinds }).map((g) => `${g.kind}: ${g.why}`);

test("every required kind at the head with exit 0 and not_verified filled passes", () => {
  assert.deepEqual(gaps([ev("test"), ev("run")]), []);
  assert.deepEqual(gaps([ev("test", { head_sha: HEAD.slice(0, 7) }), ev("run")]), [], "a short sha of the head counts");
  assert.deepEqual(gaps([], []), [], "V0 asks for none");
});

test("a missing kind, another head, another PR, a non-zero exit or an empty not_verified is a gap", () => {
  assert.deepEqual(gaps([ev("test")]), ["run: no row"]);
  assert.deepEqual(gaps([ev("test"), ev("run", { head_sha: "b".repeat(40) })]), ["run: no row"]);
  assert.deepEqual(gaps([ev("test"), ev("run", {}, { subject: "acme/api#13" })]), ["run: no row"]);
  assert.deepEqual(gaps([ev("test"), ev("run", { exit_code: 1 })]), ["run: exit_code 1"]);
  assert.deepEqual(gaps([ev("test"), ev("run", { exit_code: undefined })]), ["run: exit_code missing"]);
  assert.deepEqual(gaps([ev("test"), ev("run", { not_verified: [] })]), ["run: not_verified empty"]);
});

test("the latest row of a kind at the head decides", () => {
  assert.deepEqual(gaps([ev("test"), ev("run"), ev("run", { exit_code: 2 })]), ["run: exit_code 2"]);
  assert.deepEqual(gaps([ev("test"), ev("run", { exit_code: 2 }), ev("run")]), []);
});

test("the author cannot write passing evidence for their own PR (R-04)", () => {
  assert.deepEqual(gaps([ev("test", {}, { actor: "Alice" }), ev("run")]), ["test: written by the PR's author"]);
  assert.deepEqual(gaps([ev("test", {}, { actor: null }), ev("run")]), ["test: writer unknown"]);
  assert.deepEqual(gaps([ev("test"), ev("test", {}, { actor: "alice" }), ev("run")]), [], "the author's row is skipped, not counted as latest");
});

test("acceptance 5: an item with deploys_after is not done without dev evidence, even at V0", () => {
  const dev = [row("stage_recorded", { pr: PR, stage: "dev", sha: HEAD }), ev("dev")];
  assert.equal(mergedItemMark({ pr: PR, deploysAfter: false, events: [] }), "done");
  assert.equal(mergedItemMark({ pr: PR, deploysAfter: true, events: [] }), "unverified");
  assert.equal(mergedItemMark({ pr: PR, deploysAfter: true, events: [dev[0] as StoredEvent] }), "unverified", "a stage row alone");
  assert.equal(mergedItemMark({ pr: PR, deploysAfter: true, events: [dev[1] as StoredEvent] }), "unverified", "evidence alone");
  assert.equal(mergedItemMark({ pr: PR, deploysAfter: true, events: dev }), "done");
  assert.equal(mergedItemMark({ pr: PR, deploysAfter: true, events: [dev[0] as StoredEvent, ev("dev", { exit_code: 1 })] }), "unverified");
});
