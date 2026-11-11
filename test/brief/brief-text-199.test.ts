import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import briefCommand, { brief } from "../../cli/commands/brief.ts";
import { type BriefInput, briefText, buildBrief, panelView, renderMarkdown, tableWidths } from "../../core/index.ts";
import { renderStage } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "./group-world.ts";

// Decision 199 ⑥: the chat text carries the same 완료 최근 7일 list (folded to its count line, opened with
// --done) and the 0-groups line the panel shows.

let input: BriefInput;
test.before(async () => {
  input = await (await groupWorld()).input();
});

const text = (target: Parameters<typeof briefText>[1]) => {
  const r = briefText(input, target);
  assert.ok(r.ok);
  return r.value;
};

test("현황 text: folded by default to the summary count, the bottom line as decision 89 fixed it; --done lists every done row", () => {
  const folded = text({});
  assert.doesNotMatch(folded, /### ✅ 완료 최근 7일/);
  assert.match(folded, /^✅ 완료 2건 · /m);
  assert.match(folded, /^완료는 최근 7일 · 🔍/m);
  const open = text({ done: true });
  const list = open.slice(open.indexOf("### ✅ 완료 최근 7일 2"));
  assert.match(list, /^### ✅ 완료 최근 7일 2\n\n\| 항목 \| PR \| 닫힘 \|/);
  assert.match(list, /\| i024 인덱스 추가 \| \[acme\/api#38\]\(https:\/\/github\.com\/acme\/api\/pull\/38\) \|/);
  assert.ok(open.indexOf("### ✅ 완료 최근 7일") > open.indexOf("### 진행 중"), "the list sits under the four tables");
});

test("묶음 상세 text: --done opens the same list under the state sections", () => {
  assert.doesNotMatch(text({ group: "api-migration" }), /### ✅ 완료 최근 7일/);
  const open = text({ group: "api-migration", done: true });
  assert.match(open, /### ✅ 완료 최근 7일 2\n\n\| 항목 \| PR \| 닫힘 \|/);
  assert.match(open, /i024 인덱스 추가/);
  assert.match(text({ group: "api-migration" }), /^✅ 완료 최근 7일 2건 \(접힘\) · 항목:/m);
  assert.doesNotMatch(open, /\(접힘\)/);
});

test("the opened list keeps the text's table limits: 78 cells, 5 columns", () => {
  for (const out of [text({ done: true }), text({ group: "api-migration", done: true })]) {
    for (const w of tableWidths(out)) assert.ok(w.width <= 78 && w.cols <= 5, `line ${w.line}`);
  }
});

test("0 groups: the text says how a group comes to be, the panel's line without its panel note; with groups it is gone", () => {
  const m = buildBrief(input, {});
  assert.ok(m.groups > 0);
  assert.doesNotMatch(renderMarkdown(m), /묶음이 아직 없다/);
  const zero = { ...m, groups: 0, inProgress: { ...m.inProgress, rows: [], count: 0 } };
  const line = /^묶음이 아직 없다\..*$/m.exec(renderMarkdown(zero))?.[0];
  assert.ok(line, "the text has the line");
  const view = panelView(input, {});
  assert.ok(view.ok);
  const stage = { ...view.value, model: zero } as unknown as Parameters<typeof renderStage>[0];
  const panel = /<p class="hint0"[^>]*>([^<]*)<\/p>/.exec(renderStage(stage))?.[1];
  assert.equal(panel, `${line} 패널은 리드를 띄우지 않는다.`);
  const out = renderMarkdown(zero);
  assert.ok(out.indexOf(line) > out.indexOf("### 진행 중"), "under 진행 중");
});

test("sangsoe brief takes --done as a flag and hands it to the text", async () => {
  assert.deepEqual(briefCommand.options.done, { type: "boolean" });
  const fix = (f: string) => fileURLToPath(new URL(`../fixtures/brief/${f}`, import.meta.url));
  const values = { events: fix("sample.events.jsonl"), orca: fix("sample.orca.json"), now: "2026-11-10T12:00:00.000Z" };
  const folded = await brief({ values, positionals: [] });
  const open = await brief({ values: { ...values, done: true }, positionals: [] });
  assert.ok(folded.ok && open.ok);
  assert.doesNotMatch(String(folded.value), /### ✅ 완료 최근 7일/);
  assert.match(String(open.value), /### ✅ 완료 최근 7일 2\n/);
});
