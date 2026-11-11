// The golden text is drawn in UTC; decision 198's local time is pinned in test/panel/decision-198.test.ts.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { decision } from "../store/views/decision.ts";
import type { StoredEvent } from "../contract/index.ts";
import { buildBrief, buildGroup, buildItem } from "./build.ts";
import { group_brief } from "./group.ts";
import { item_status } from "./item_status.ts";
import { owner_todo } from "./owner_todo.ts";
import { renderMarkdown } from "./render.ts";
import { replayJsonl } from "./replay.ts";
import type { BriefInput, BriefSnapshot, Overview, Table } from "./types.ts";
import { tableWidths } from "./width.ts";

const FIX = new URL("../../test/fixtures/brief/", import.meta.url);
const NOW = "2026-11-10T12:00:00.000Z";
const events = replayJsonl(readFileSync(new URL("sample.events.jsonl", FIX), "utf8"));
const orca = JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot;
const input = (over: Partial<BriefInput> = {}): BriefInput => ({ orca, events, now: NOW, ...over });
const opts = { doneDays: 7, showHours: 24 };

const model = buildBrief(input(), opts);
const text = renderMarkdown(model, { maxWidth: 78 });

const itemRows = (t: Table | null) => (t ? t.rows.filter((r) => /^i\d{3,}$/.test(r.id)) : []);
const stateOf = (t: Table, id: string) => t.rows.find((r) => r.id === id)?.cells[0]?.text;

test("golden: sample.events.jsonl renders exactly sample.md (UPDATE_GOLDEN=1 rewrites it)", () => {
  const golden = new URL("sample.md", FIX);
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, text);
  assert.equal(text, readFileSync(golden, "utf8"));
});

test("(1) section order; empty first two sections show 없음; 보류 is left out when empty", () => {
  const heads = text.split("\n").filter((l) => l.startsWith("### "));
  assert.deepEqual(
    heads.map((h) => h.replace(/ \d+$/, "")),
    ["### 결정 필요", "### 지금 오너가 할 일", "### 열린 항목", "### 보류"],
  );
  const bare = input({ events: events.filter((e) => !/^(decision_|waiting_|escalation_stale)/.test(e.type)), orca: { ...orca, gates: [] } });
  const noHold = { ...bare, orca: { ...bare.orca, tasks: bare.orca.tasks.filter((t) => !["task_28", "task_41", "task_35"].includes(t.id)) } };
  const out = renderMarkdown(buildBrief(noHold, opts), { maxWidth: 78 });
  assert.match(out, /### 결정 필요 0\n\n없음\n/);
  assert.match(out, /### 지금 오너가 할 일 0\n\n없음\n/);
  assert.doesNotMatch(out, /### 보류/);
});

test("(2) rows = view rows: decisions only in (1), owner items only in (2), none folded", () => {
  const open = decision(input()).filter((d) => d.state === "open");
  assert.deepEqual(model.decisions.rows.map((r) => r.id).sort(), open.map((d) => d.decision).sort());
  const todo = owner_todo(input());
  assert.deepEqual(
    model.ownerTodo.rows.map((r) => r.id).sort(),
    todo.filter((t) => t.kind !== "decision").map((t) => t.ref).sort(),
  );
  const inTodo = new Set(itemRows(model.ownerTodo).map((r) => r.id));
  for (const r of model.inProgress.rows) assert.ok(!inTodo.has(r.id), `${r.id} is in both 할 일 and 진행 중`);
  for (const r of model.inProgress.rows) assert.ok(!/^d\d+$/.test(r.id), "no decision row in 진행 중");
  // Every open item (not done, not cancelled) has exactly one row somewhere.
  const openAliases = item_status(input())
    .filter((r) => r.state !== "done" && r.state !== "cancelled")
    .map((r) => r.alias)
    .sort();
  const drawn = [model.inProgress, model.ownerTodo, model.onHold].flatMap((t) => itemRows(t).map((r) => r.id)).sort();
  assert.deepEqual(drawn, openAliases);
});

test("(3) the header and section counts are owner_todo's", () => {
  const todo = owner_todo(input());
  assert.equal(model.todo.total, todo.length);
  assert.equal(model.todo.decisions, todo.filter((t) => t.kind === "decision").length);
  assert.equal(model.decisions.count, model.todo.decisions);
  assert.equal(model.ownerTodo.count, model.todo.other);
  assert.match(text.split("\n")[0] ?? "", /내가 할 일 5 \(결정 2 \+ 할 일 3\)$/);
});

test("(4) every table has at most 5 columns and is at most 78 cells wide", () => {
  const widths = tableWidths(text);
  assert.ok(widths.length >= 4);
  for (const w of widths) {
    assert.ok(w.cols <= 5, `line ${w.line}: ${w.cols} columns`);
    assert.ok(w.width <= 78, `line ${w.line}: ${w.width} cells`);
  }
  assert.equal(tableWidths("| 한글 | ⏸️ | [acme/api#1](https://github.com/acme/api/pull/1) |")[0]?.width, 4 + 2 + 10 + 10);
});

test("(5) long names, a long repo and a | are cut with …, URLs kept whole, no line breaks in a row", () => {
  const i027 = text.split("\n").find((l) => l.includes("i027")) ?? "";
  assert.match(i027, /결제 \\\| .*…/);
  assert.match(i027, /\[paymen…#1234\]\(https:\/\/github\.com\/acme-platform-infrastructure\/payments-service\/pull\/1234\)/);
  assert.match(text, /\*\*billing-platform-con… P2\*\*/);
  for (const l of text.split("\n").filter((x) => x.startsWith("|"))) assert.ok(l.endsWith("|"), l);
});

test("(6) the model's row IDs are the rendered row IDs", () => {
  const tables: (Table | null)[] = [model.decisions, model.ownerTodo, model.inProgress, model.onHold];
  const ids = tables.flatMap((t) => (t ? t.rows.map((r) => r.id) : [])).filter((id) => !id.startsWith("lead:"));
  const rendered = text
    .split("\n")
    .filter((l) => l.startsWith("| ") && !/^\| (ID|상태) \|/.test(l))
    .map((l) => /(?:^\| (?:[^|]+\| )?(?:└ )?)([di]\d{3,})\b/.exec(l)?.[1] ?? /\[([a-z0-9_./-]+#\d+)\]/.exec(l)?.[1])
    .filter((id): id is string => id !== undefined)
    .filter((id) => !/#/.test(id) || text.includes(`오너 직접`));
  const leads = tables.flatMap((t) => (t ? t.rows.filter((r) => r.id.startsWith("lead:")) : []));
  assert.equal(text.split("\n").filter((l) => /^\| \S+ \| \*\*/.test(l)).length, leads.length);
  assert.deepEqual(
    rendered.filter((id) => /^[di]\d/.test(id)),
    ids.filter((id) => /^[di]\d/.test(id)),
  );
  assert.deepEqual(
    ids.filter((id) => id.startsWith("act:")).map((id) => id.slice(4)),
    text.split("\n").filter((l) => l.includes("오너 직접")).map((l) => /\[([^\]]+)\]/.exec(l)?.[1]),
  );
});

test("(7) the count line's four numbers are the table rows per bucket", () => {
  const s = model.summary;
  const rows = model.inProgress.rows.filter((r) => /^i\d/.test(r.id));
  const by = (e: string) => rows.filter((r) => r.cells[0]?.text === e).length;
  assert.equal(s.doing, by("🔄"));
  assert.equal(s.left, by("🟢") + by("📅") + itemRows(model.onHold).length);
  assert.equal(s.blocked, by("🚧") + itemRows(model.ownerTodo).length);
  assert.equal(s.done, 2, "i020 and i022 closed inside 7 days; i021 is older, i023 cancelled");
  const all = itemRows(model.inProgress).length + itemRows(model.ownerTodo).length + itemRows(model.onHold).length;
  assert.equal(s.done + s.doing + s.left + s.blocked, all + s.done);
  assert.equal(text.split("\n")[2], `✅ 완료 ${s.done}건 · 🔄 진행 중 ${s.doing}건 · 남은 것 ${s.left}건 · 🚧 막힌 것 ${s.blocked}건`);
  assert.equal(stateOf(model.inProgress, "i040"), "🚧", "an answer not yet delivered keeps its waiter blocked (84③)");
});

test("(8) owner_act_unlinked: one PR row inside show_hours, counted in N, no bucket; gone after", () => {
  const sum = (m: Overview) => m.summary.done + m.summary.doing + m.summary.left + m.summary.blocked;
  const acts = (m: Overview) => m.inProgress.rows.filter((r) => r.id.startsWith("act:"));
  assert.deepEqual(acts(model).map((r) => r.id), ["act:acme/api#77"]);
  const later = buildBrief(input({ now: "2026-11-11T09:00:01.000Z" }), opts);
  assert.equal(acts(later).length, 0);
  assert.equal(model.inProgress.count, later.inProgress.count + 1);
  assert.equal(sum(model) - model.summary.done, sum(later) - later.summary.done);
  assert.equal(model.inProgress.count, model.inProgress.rows.filter((r) => !r.id.startsWith("lead:")).length);
});

// A refused start on a real item is that item's row (impl 0134); test/owner/owner-todo.test.ts pins it.
test("an escalation{to owner} naming no item adds no owner_todo row", () => {
  assert.ok(events.some((e) => e.type === "escalation" && e.payload.to === "owner"));
  const without = input({ events: events.filter((e) => e.type !== "escalation") });
  assert.equal(owner_todo(input()).length, owner_todo(without).length);
});

const extra = (type: string, payload: Record<string, unknown>, more: Partial<StoredEvent> = {}): StoredEvent => {
  const seq = Math.max(...events.map((e) => e.seq)) + 1 + (more.seq ?? 0);
  const base = { ...events[0], ts: "2026-11-10T11:40:00.000Z", type, payload, entity: null, entity_id: null, subject: null, dedupe_key: null };
  return { ...base, ...more, seq } as StoredEvent;
};

test("a waiting session on an owner item is one row in owner_todo and in the brief", () => {
  const wait = extra("waiting_human", { session: "sess-35", tool: "Bash" }, { entity: "task", entity_id: "task_35" });
  const stale = extra("escalation_stale", { ref: String(wait.seq), reason: "waiting_unreleased" }, { seq: 1 });
  const i = input({ events: [...events, wait, stale] });
  const view = owner_todo(i);
  assert.equal(view.filter((r) => r.ref === "i035").length, 1);
  assert.equal(buildBrief(i, opts).todo.total, view.length);
});

test("a lead row's N건·막힘 M is group_brief's, the same as the stage 2 header", () => {
  for (const g of group_brief(input())) {
    const row = model.inProgress.rows.find((r) => r.id === `lead:${g.lead}`);
    assert.ok(row, g.lead);
    assert.equal(row.cells[3]?.text, `${g.items}건·막힘 ${g.blocked}`);
    const detail = buildGroup(input(), g.lead, opts);
    assert.equal(`${detail?.items}건·막힘 ${detail?.blockedCount}`, row.cells[3]?.text);
  }
});

test("the owner_act_unlinked row: 상태 —, 다음 오너 직접 · 연결?; an upper-case repo keeps its PR link", () => {
  const act = model.inProgress.rows.find((r) => r.id === "act:acme/api#77");
  assert.deepEqual([act?.cells[0]?.text, act?.cells[3]?.text], ["—", "오너 직접 · 연결?"]);
  const upper = extra("owner_act_unlinked", { act: "Acme/API#78 직접 머지" });
  const m = buildBrief(input({ events: [...events, upper] }), opts);
  assert.ok(m.inProgress.rows.some((r) => r.id === "act:acme/api#78" && r.cells[2]?.link === "https://github.com/acme/api/pull/78"));
});

test("stage 2: group rows by state, dependency edges, critical path and why-not-ready", () => {
  const g = buildGroup(input(), "api-migration", opts);
  assert.ok(g);
  assert.deepEqual(g.sections.map((s) => s.title), ["🚧 막힘", "🔄 진행 중", "대기열"]);
  assert.deepEqual(g.edges, [{ pred: "i033", succ: "i029", kind: "blocks", met: false }]);
  assert.deepEqual(g.criticalPath, ["i033", "i029"]);
  // Decision 218: each 🚧 item has its row, the Orca-blocked one with the lead's reason, the gated one with its decision.
  assert.deepEqual(g.why.rows.map((r) => r.cells.map((c) => c.text)), [
    ["i033", "orca", "orca", "🚧 막힘", "키 도착 확인"],
    ["i031", "decision:d012", "gate", "열림", "오너의 답을 기다린다"],
    ["i029", "i033", "blocks", "🚧", "키 도착 확인"],
  ]);
  assert.equal(g.doneFolded, 2);
  const out = renderMarkdown(g, { maxWidth: 78 });
  for (const w of tableWidths(out)) assert.ok(w.width <= 78 && w.cols <= 5, `line ${w.line}`);
  assert.match(out, /크리티컬 패스: i033 → i029/);
});

test("stage 3: raw owner text → class → transitions → evidence → PR and decisions", () => {
  const it = buildItem(input(), "i031", opts);
  assert.ok(it);
  assert.deepEqual(
    it.chain.rows.map((r) => r.cells[1]?.text),
    ["원문", "분류", "생성", "PR", "결정", "전환"],
  );
  const out = renderMarkdown(it, { maxWidth: 78 });
  assert.match(out, /^항목 상세 · i031 웹훅 재시도 정책 적용/);
  for (const w of tableWidths(out)) assert.ok(w.width <= 78 && w.cols <= 5, `line ${w.line}`);
});
