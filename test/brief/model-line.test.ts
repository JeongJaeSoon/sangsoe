// Decision 200: the item detail shows the row start_unit picked and the unit's advisor spend; the
// overview adds today's spend only on a day with advisor calls. Neither event becomes a chain row.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  type BriefInput,
  type BriefSnapshot,
  buildBrief,
  buildItem,
  MODEL_CATALOG,
  MODEL_POLICY,
  renderMarkdown,
  replayJsonl,
} from "../../core/index.ts";

const FIX = new URL("../fixtures/brief/", import.meta.url);
const NOW = "2026-11-10T12:00:00.000Z";
const base = readFileSync(new URL("sample.events.jsonl", FIX), "utf8");
const orca = JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot;
const line = (ts: string, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ts, type, source: "test", payload, ...extra });
const withEvents = (...lines: string[]): BriefInput => ({ events: replayJsonl(`${base}\n${lines.join("\n")}\n`), orca, now: NOW });

const row = MODEL_POLICY.worker;
const alias = (tier: string | undefined) => MODEL_CATALOG.find((c) => c.tier === tier);
const advisor = alias(row.advisor);
const STARTED = line(
  "2026-11-10T10:00:00.000Z",
  "unit_started",
  { kind: "worker", picked_by: "class", model: alias(row.tier)?.alias, effort: row.effort, advisor: advisor?.alias, route: "worktree_file", budget: 2, budget_per: "unit", used: 0 },
  { entity: "task", entity_id: "task_26" },
);
const USED = line(
  "2026-11-10T11:00:00.000Z",
  "advisor_used",
  { session: "sess-26", msg: "msg_1:1", model: advisor?.currentId, input_tokens: 1_000_000, output_tokens: 0 },
  { entity: "task", entity_id: "task_26" },
);

// The budget is the one the start recorded (2 here), not the table's: no second source.
test("the item detail carries one model line with the row, the recorded budget and the unit's spend", () => {
  const before = buildItem(withEvents(), "i026");
  const after = buildItem(withEvents(STARTED, USED), "i026");
  assert.ok(before && after);
  assert.equal(before.model, undefined);
  assert.equal(after.chain.rows.length, before.chain.rows.length, "no chain row for either event");
  const price = advisor?.price.input ?? 0;
  assert.equal(
    after.model,
    `모델: ${row.label} · ${alias(row.tier)?.alias} · effort ${row.effort} · advisor ${advisor?.alias} · 예산 2회/단위 · advisor 1회 · 약 $${price.toFixed(2)}`,
  );
  assert.ok(renderMarkdown(after).split("\n")[1]?.startsWith("모델: "));
});

test("the overview adds today's advisor spend only when there was any", () => {
  assert.equal(buildBrief(withEvents()).advisorToday, undefined);
  const o = buildBrief(withEvents(STARTED, USED));
  assert.match(o.advisorToday ?? "", /^오늘 advisor 1회 · 약 \$/);
  assert.ok(renderMarkdown(o).trimEnd().endsWith(o.advisorToday ?? "-"));
});
