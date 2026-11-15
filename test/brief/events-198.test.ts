// Decision 198: decision 186's nine events show in the item chain and on the brief's 🚨 and 대기 lines,
// and a cancelled Task, as Orca's task-list --full gives it, reads 🗑️. The rows go through the store's
// contract (replayJsonl), so a payload the contract refuses fails here.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type BriefInput, type BriefSnapshot, buildBrief, buildItem, itemFacts, type OrcaAdapter, readSnapshot, replayJsonl } from "../../core/index.ts";

const FIX = new URL("../fixtures/brief/", import.meta.url);
const NOW = "2026-11-10T12:00:00.000Z";
const base = readFileSync(new URL("sample.events.jsonl", FIX), "utf8");
const orca = JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot;
const line = (ts: string, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ts, type, source: "test", payload, ...extra });
const withEvents = (...lines: string[]): BriefInput => ({ events: replayJsonl(`${base}\n${lines.join("\n")}\n`), orca, now: NOW });

const NINE = [
  line("2026-11-10T11:00:00.000Z", "pr_review_requested", { pr: "acme/api#40", reviewer: "bob" }),
  line("2026-11-10T11:01:00.000Z", "review_commented", { pr: "acme/api#40", reviewer: "bob" }),
  line("2026-11-10T11:02:00.000Z", "review_replied", { pr: "acme/api#40", by: "w-api-1" }),
  line("2026-11-10T11:03:00.000Z", "pr_changes_requested", { pr: "acme/api#40", reviewer: "bob" }),
  // As core/graph/edit.ts writes it (U54): the root item as `subject`.
  line("2026-11-10T11:04:00.000Z", "flow_step_skipped", { step: "dev", reason: "no deploy" }, { subject: "item:task_26" }),
  line("2026-11-10T11:05:00.000Z", "worker_idle", { session: "sess-26" }, { entity: "task", entity_id: "task_26" }),
  line("2026-11-10T11:06:00.000Z", "observed_change", { task: "task_26", field: "status" }),
  line("2026-11-10T11:07:00.000Z", "refusal_report", { act: "land", category: "no verdict", command_file: "/tmp/r/1.txt" }, { entity: "task", entity_id: "task_26" }),
  line("2026-11-10T11:08:00.000Z", "worker_done", { dispatch: "ctx_26", task: "task_26", msg_id: "msg_26" }),
];

test("the nine events each leave one chain row in the owner's words", () => {
  const before = buildItem(withEvents(), "i026");
  const after = buildItem(withEvents(...NINE), "i026");
  assert.ok(before && after);
  const added = after.chain.rows.slice(before.chain.rows.length).map((r) => [r.cells[0]?.text, r.cells[1]?.text, r.cells[2]?.text]);
  assert.deepEqual(added, [
    ["11-10 11:00", "PR", "acme/api#40 리뷰 요청 bob"],
    ["11-10 11:01", "PR", "acme/api#40 리뷰 코멘트 bob"],
    ["11-10 11:02", "PR", "acme/api#40 리뷰에 답함 w-api-1"],
    ["11-10 11:03", "PR", "acme/api#40 변경 요청 bob"],
    ["11-10 11:04", "흐름", "dev 건너뜀: no deploy"],
    ["11-10 11:05", "대기", "워커가 다음 지시를 기다림"],
    ["11-10 11:06", "신호", "Orca 에서 status 바뀜"],
    ["11-10 11:07", "거부", "land 거부됨(no verdict)"],
    ["11-10 11:08", "보고", "워커 완료 보고 받음"],
  ]);
});

test("the events that ask for action or judgment raise 🚨 until the item moves; worker_idle is the 대기 line", () => {
  const facts = (i: BriefInput) => itemFacts(i).find((f) => f.alias === "i026");
  const quiet = facts(withEvents());
  assert.ok(quiet);
  assert.equal(quiet.idle, false);

  const loud = facts(withEvents(...NINE));
  assert.ok(loud);
  assert.deepEqual([...loud.alarms].sort(), [...quiet.alarms, "pr_changes_requested", "refusal_report", "review_commented"].sort());
  const row = buildBrief(withEvents(...NINE)).inProgress.rows.find((r) => r.id === "i026");
  assert.match(row?.cells[3]?.text ?? "", /^🚨 /);

  const idle = facts(withEvents(NINE[5] ?? ""));
  assert.ok(idle);
  assert.equal(idle.state, "in_progress");
  assert.equal(idle.idle, true);
  assert.match(buildBrief(withEvents(NINE[5] ?? "")).inProgress.rows.find((r) => r.id === "i026")?.cells[3]?.text ?? "", /워커가 지시를 기다림$/, "the 다음 column's label is the word, so the text does not repeat it");

  const moved = facts(withEvents(...NINE, line("2026-11-10T11:30:00.000Z", "item_transition", { task: "task_26", from: "in_progress", to: "blocked", reason: "review" })));
  assert.deepEqual(moved?.alarms, [], "an alarm stands until the item moves again");
});

test("#45: a Task Orca's task-list --full gives as failed + result cancelled reads 🗑️ and is not counted", async () => {
  // The row shape recorded read-only on 2026-11-11 (status "failed", result the plain string "cancelled").
  const rows = orca.tasks.map((t) => ({ id: t.id, status: t.status, title: t.title ?? t.id, deps: JSON.stringify(t.deps), ...(t.result ? { result: t.result } : {}) }));
  const target = rows.find((r) => r.id === "task_26");
  assert.ok(target);
  Object.assign(target, { status: "failed", result: "cancelled" });
  const adapter = {
    taskList: async () => ({ ok: true, value: rows }),
    gateList: async () => ({ ok: true, value: [] }),
  } as unknown as OrcaAdapter;
  const snap = await readSnapshot(adapter, ["run_acme"]);
  assert.ok(snap.ok);
  const input: BriefInput = { events: replayJsonl(base), orca: snap.value, now: NOW };
  assert.equal(itemFacts(input).find((f) => f.alias === "i026")?.state, "cancelled");
  assert.equal(buildItem(input, "i026")?.state, "🗑️");
  assert.ok(!buildBrief(input).inProgress.rows.some((r) => r.id === "i026"), "a cancelled item leaves 진행 중");
});
