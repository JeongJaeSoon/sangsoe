// Decision 254: the model a started session resolved to against what start_unit passed and the table
// expects. Both sides are rows the store already has (unit_started, session_started); the check is a
// read, so nothing new is stored and a drift is shown again only while it still holds.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  type BriefInput,
  type BriefSnapshot,
  buildItem,
  MODEL_CATALOG as CATALOG,
  modelDrift,
  modelTable,
  replayJsonl,
  VERIFIED_WITH_CLAUDE_CODE,
} from "../core/index.ts";
import { defaultDbPath, Store } from "../core/store/store.ts";

const everyday = CATALOG.find((r) => r.tier === "everyday");
const primary = CATALOG.find((r) => r.tier === "primary");
assert.ok(everyday && primary);
// A release the table has not seen yet, built from the table so no model name is written here.
const MOVED = `${everyday.currentId}-next`;

type Ev = { seq: number; ts: string; type: string; entity_id: string | null; payload: Record<string, unknown> };
let seq = 0;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 14, 9, minute)).toISOString();
const unit = (task: string, model: string, minute: number): Ev => ({
  seq: ++seq,
  ts: at(minute),
  type: "unit_started",
  entity_id: task,
  payload: { kind: "worker", picked_by: "role", model, effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0 },
});
const session = (task: string | null, model: string, minute: number): Ev => ({
  seq: ++seq,
  ts: at(minute),
  type: "session_started",
  entity_id: task,
  payload: { session: `s-${seq}`, role: "worker", model },
});

test("an alias that moved gives one drift naming the alias, the table's model and the resolved one", () => {
  const drifts = modelDrift([unit("t1", everyday.alias, 0), session("t1", MOVED, 1)]);
  assert.equal(drifts.length, 1);
  const [d] = drifts;
  assert.equal(d?.alias, everyday.alias);
  assert.equal(d?.expected, everyday.currentId);
  assert.equal(d?.actual, MOVED);
  assert.equal(d?.cause, "alias_moved");
  assert.equal(d?.task, "t1");
});

test("no drift when every session resolved to the table's model", () => {
  assert.deepEqual(modelDrift([unit("t1", everyday.alias, 0), session("t1", everyday.currentId, 1), unit("t2", primary.alias, 2), session("t2", primary.currentId, 3)]), []);
  // Claude Code's context-window suffix is not a different model.
  assert.deepEqual(modelDrift([unit("t1", primary.alias, 0), session("t1", `${primary.currentId}[1m]`, 1)]), []);
});

test("the same drift across many sessions is one line, and it clears once the newest session matches", () => {
  const held = [unit("a", everyday.alias, 0), session("a", MOVED, 1), unit("b", everyday.alias, 2), session("b", MOVED, 3), session("b", MOVED, 4)];
  const once = modelDrift(held);
  assert.equal(once.length, 1, "one line per drift, however many sessions show it");
  assert.equal(once[0]?.sessions, 3);
  assert.equal(once[0]?.task, "b", "the newest session names the Task");
  assert.deepEqual(modelDrift([...held, unit("c", everyday.alias, 5), session("c", everyday.currentId, 6)]), [], "no longer holds");
});

test("a pin in the owner's settings for that alias is named as the likely cause", () => {
  const key = `ANTHROPIC_DEFAULT_${everyday.alias.toUpperCase()}_MODEL`;
  const [d] = modelDrift([unit("t1", everyday.alias, 0), session("t1", MOVED, 1)], [`${key}=${MOVED}`]);
  assert.equal(d?.cause, "pin");
  assert.equal(d?.pin, key);
  // A pin on another alias says nothing about this one.
  const other = `ANTHROPIC_DEFAULT_${primary.alias.toUpperCase()}_MODEL`;
  assert.equal(modelDrift([unit("t1", everyday.alias, 0), session("t1", MOVED, 1)], [`${other}=x`])[0]?.cause, "alias_moved");
});

test("a session on another tier's model is named as such", () => {
  const [d] = modelDrift([unit("t1", everyday.alias, 0), session("t1", primary.currentId, 1)]);
  assert.equal(d?.cause, "other_tier");
  assert.equal(d?.actual, primary.currentId);
});

test("sessions with no unit_started, an unknown model or a session before its start are not compared", () => {
  assert.deepEqual(modelDrift([session(null, MOVED, 0), session("t9", MOVED, 1)]), [], "the owner's own sessions have no expectation");
  assert.deepEqual(modelDrift([unit("t1", everyday.alias, 0), session("t1", "unknown", 1)]), []);
  assert.deepEqual(modelDrift([session("t1", MOVED, 0), unit("t1", everyday.alias, 1)]), [], "a session pairs only with an earlier start");
});

function ctx(home: string, env: Record<string, string> = {}) {
  return {
    orca: { worktreeList: async () => ({ ok: true, value: { rows: [], nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false } }) } as never,
    exec: async () => ({ code: 0, stdout: `${VERIFIED_WITH_CLAUDE_CODE} (Claude Code)\n`, stderr: "" }),
    coreVersion: "0",
    home,
    now: new Date(Date.parse(`${everyday.verified}T00:00:00Z`) + 86_400_000),
    env,
  };
}

function seed(home: string, events: Ev[]): void {
  const path = defaultDbPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const store = Store.open({ path });
  try {
    for (const e of events) store.append({ type: e.type, source: "test", entity: "task", entity_id: e.entity_id ?? "x", payload: e.payload } as never);
  } finally {
    store.close();
  }
}

test("doctor's model-table row: a notice naming the drift, and ok without one", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-drift-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seed(home, [unit("t1", everyday.alias, 0), session("t1", everyday.currentId, 1)]);
  const ok = await modelTable.run(ctx(home));
  assert.equal(ok.status, "ok", ok.summary);
  assert.doesNotMatch(ok.summary, /풀렸다/);
  seed(home, [unit("t2", everyday.alias, 2), session("t2", MOVED, 3), unit("t3", everyday.alias, 4), session("t3", MOVED, 5)]);
  const moved = await modelTable.run(ctx(home));
  assert.equal(moved.status, "notice", moved.summary);
  const hits = moved.summary.split("; ").filter((s) => s.includes(MOVED));
  assert.equal(hits.length, 1, moved.summary);
  assert.ok(hits[0]?.includes(everyday.alias) && hits[0].includes(everyday.currentId), hits[0]);
  assert.match(moved.fix ?? "", /re-read the pages/);
});

test("the item detail's model line names the resolved model only when it drifted", () => {
  const FIX = new URL("fixtures/brief/", import.meta.url);
  const base = readFileSync(new URL("sample.events.jsonl", FIX), "utf8");
  const orca = JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot;
  const line = (e: Ev) => JSON.stringify({ ts: e.ts, type: e.type, source: "test", entity: "task", entity_id: e.entity_id, payload: e.payload });
  const input = (...es: Ev[]): BriefInput => ({ events: replayJsonl(`${base}\n${es.map(line).join("\n")}\n`), orca, now: at(30) });
  const same = buildItem(input(unit("task_26", everyday.alias, 0), session("task_26", everyday.currentId, 1)), "i026");
  assert.doesNotMatch(same?.model ?? "", /세션/);
  const drifted = buildItem(input(unit("task_26", everyday.alias, 0), session("task_26", MOVED, 1)), "i026");
  assert.ok(drifted?.model?.includes(`세션 ${MOVED} (표 ${everyday.currentId})`), drifted?.model);
});
