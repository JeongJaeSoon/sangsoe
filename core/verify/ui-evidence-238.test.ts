import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../contract/index.ts";
import { evidenceGaps } from "./evidence.ts";
import { parseTierConfig, tierConfigGaps } from "./verify-tier.ts";

// Decision 238: a repository can say where its screen evidence is taken and what it measures. A `ui`
// row for that repository then names the surface and each measure in `observed`, or land refuses it.

const PR = "acme/web#7";
const HEAD = "c".repeat(40);
const ui = (observed?: string): StoredEvent => ({
  seq: 1,
  ts: "2026-11-14T00:00:00Z",
  type: "evidence",
  source: "test",
  target: null,
  subject: PR,
  entity: null,
  entity_id: null,
  actor: "lead:l1",
  needs: "none",
  severity: null,
  dedupe_key: null,
  schema_v: 1,
  before: null,
  payload: { kind: "ui", head_sha: HEAD, exit_code: 0, not_verified: ["390px"], ...(observed === undefined ? {} : { observed }) },
});
const RULE = { surface: ["orca-panel"], measures: ["first_read_ms", "scrolls", "hscroll"] };
const gaps = (row: StoredEvent, rule?: typeof RULE) =>
  evidenceGaps([row], { pr: PR, head: HEAD, author: "alice", kinds: ["ui"], ...(rule ? { ui: rule } : {}) }).map((g) => g.why);

test("238: with a rule, a ui row that does not say where and what it measured is a gap", () => {
  assert.deepEqual(gaps(ui(), RULE), ["observed names no surface (one of orca-panel)"]);
  assert.deepEqual(gaps(ui("looked fine"), RULE), ["observed names no surface (one of orca-panel)"]);
  assert.deepEqual(gaps(ui(JSON.stringify({ surface: "browser", first_read_ms: 900, scrolls: 0, hscroll: 0 })), RULE), [
    "observed surface browser is not one of orca-panel",
  ]);
  assert.deepEqual(gaps(ui(JSON.stringify({ surface: "orca-panel", first_read_ms: 900 })), RULE), ["observed lacks scrolls, hscroll"]);
  assert.deepEqual(gaps(ui(JSON.stringify({ surface: "orca-panel", first_read_ms: "fast", scrolls: 0, hscroll: 0 })), RULE), [
    "observed lacks first_read_ms",
  ]);
});

test("238: a ui row with the surface and every measure passes; without a rule nothing changes", () => {
  assert.deepEqual(gaps(ui(JSON.stringify({ surface: "orca-panel", first_read_ms: 900, scrolls: 0, hscroll: 0 })), RULE), []);
  assert.deepEqual(gaps(ui()), [], "a repository with no rule keeps the old check");
});

const BASE = { docs_globs: [], test_globs: [], ui_globs: [], v3_globs: [], protected_paths: [] };

test("238: the rule is read per repository from verify_tier.ui_evidence, and a malformed one fails closed", () => {
  const ok = parseTierConfig({ ...BASE, ui_evidence: { "Acme/Web": RULE } });
  assert.deepEqual(ok?.ui_evidence, { "acme/web": RULE });
  assert.equal(parseTierConfig(BASE)?.ui_evidence, undefined, "the field is optional");
  for (const bad of [{ "acme/web": { surface: "orca-panel", measures: [] } }, { "acme/web": { surface: [], measures: ["x"] } }, ["acme/web"]]) {
    assert.equal(parseTierConfig({ ...BASE, ui_evidence: bad }), null, JSON.stringify(bad));
    assert.deepEqual(tierConfigGaps({ ...BASE, ui_evidence: bad }), ["ui_evidence"], JSON.stringify(bad));
  }
});
