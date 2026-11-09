import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { StoredEvent, ViewInput, Views } from "../../contract/index.ts";
import { decision } from "./decision.ts";
import { item_timeline } from "./item_timeline.ts";

let seq = 0;
const ev = (type: string, payload: Record<string, unknown>, extra: Partial<StoredEvent> = {}): StoredEvent => ({
  seq: ++seq,
  ts: `2026-11-10T00:00:${String(seq).padStart(2, "0")}.000Z`,
  type,
  source: "test",
  target: null,
  subject: null,
  entity: null,
  entity_id: null,
  actor: null,
  needs: "none",
  severity: null,
  dedupe_key: null,
  schema_v: 1,
  before: null,
  payload,
  ...extra,
});

const events: StoredEvent[] = [
  ev("owner_action", { origin: "chat", summary: "do it", hash: "h" }),
  ev("owner_class", { class: "새 일" }, { subject: "owner_action:1" }),
  ev("item_created", { task: "t1", alias: "i001", who: "worker:u1", done_when: "npm test", owner_action: 1 }),
  ev("turn_ended", { session: "s" }),
  ev("decision_opened", { decision: "d001", decision_key: "k", task: "t1", gate: "g1" }),
  ev("decision_joined", { decision: "d001", waiter: "t2", gate: "g2" }),
  ev("pr_opened", { pr: "acme/api#1", task: "t1" }),
  ev("ci_failed", { pr: "acme/api#1", run_id: "9" }),
  ev("decision_answered", { decision: "d001", owner_action: 1, answer: "A", linked_by: "hook" }),
  ev("decision_answered", { decision: "d001", owner_action: 1, answer: "B", linked_by: "hook", late: true }),
  ev("pr_merged", { pr: "acme/api#2", merge_sha: "abcdef1" }),
];

const input = (gates: { id: string; taskId: string; open: boolean }[]): ViewInput => ({
  orca: { tasks: [{ id: "t1", runId: "r1", status: "blocked", deps: [] }], gates },
  events,
  now: "2026-11-10T01:00:00.000Z",
});

test("decision folds open → joined → answered; a late answer does not replace it (5)", () => {
  const [row] = decision(input([{ id: "g1", taskId: "t1", open: false }]));
  assert.ok(row);
  assert.equal(row.state, "answered");
  assert.equal(row.answer, "A");
  assert.deepEqual(row.waiters, [
    { task: "t1", gate: "g1" },
    { task: "t2", gate: "g2" },
  ]);
  assert.equal(row.undelivered, false, "g2 is not an open gate in the snapshot");
  const [still] = decision(input([{ id: "g2", taskId: "t2", open: true }]));
  assert.equal(still?.undelivered, true, "answered while a waiter's Orca gate is still open");
  const closed = decision({ ...input([]), events: [...events, ev("decision_closed", { decision: "d001", reason: "moot" })] });
  assert.equal(closed[0]?.closedReason, "moot");
});

test("item_timeline keeps the item's own rows, its PR and decision signals, and drops noise (5)", () => {
  const rows = item_timeline(input([]), "t1");
  assert.deepEqual(
    rows.map((r) => r.type),
    [
      "owner_action",
      "owner_class",
      "item_created",
      "decision_opened",
      "decision_joined",
      "pr_opened",
      "ci_failed",
      "decision_answered",
      "decision_answered",
    ],
  );
});

test("a joined waiter's timeline carries the decision's answer and close", () => {
  const withClose = { ...input([]), events: [...events, ev("decision_closed", { decision: "d001", reason: "answered" })] };
  assert.deepEqual(
    item_timeline(withClose, "t2").map((r) => r.type),
    ["decision_opened", "decision_joined", "decision_answered", "decision_answered", "decision_closed"],
  );
});

test("decision_closed{answered} before any answer does not close the decision", () => {
  const evs = [
    ev("decision_opened", { decision: "d002", decision_key: "k2" }),
    ev("decision_closed", { decision: "d002", reason: "answered" }),
  ];
  const [row] = decision({ ...input([]), events: evs });
  assert.equal(row?.state, "open");
  assert.equal(row?.closedReason, null);
});

test("views are pure: same input, same output, input untouched", () => {
  const i = input([{ id: "g2", taskId: "t2", open: true }]);
  const before = JSON.stringify(i);
  assert.deepEqual(decision(i), decision(i));
  assert.deepEqual(item_timeline(i, "t1"), item_timeline(i, "t1"));
  assert.equal(JSON.stringify(i), before);
});

test("every view the contract names has a signature (5, 9)", () => {
  const names: (keyof Views)[] = [
    "item_status",
    "owner_todo",
    "decision",
    "ready",
    "group_brief",
    "group_items",
    "item_timeline",
    "ask_due",
    "restart_due",
  ];
  const src = readFileSync(new URL("../../contract/views.ts", import.meta.url), "utf8");
  for (const n of names) assert.match(src, new RegExp(`readonly ${n}: \\w+View;`), n);
  const implemented: Pick<Views, "decision" | "item_timeline"> = { decision, item_timeline };
  assert.ok(implemented);
});

test("contract and store read no wall clock outside the default Clock (6)", () => {
  const roots = ["../../contract", ".."].map((p) => new URL(p, import.meta.url).pathname);
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
    });
  const hits = roots
    .flatMap(walk)
    .filter((f) => !f.endsWith("/contract/clock.ts"))
    .filter((f) => /Date\.now\(|new Date\(\)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(hits, []);
});
