import assert from "node:assert/strict";
import { test } from "node:test";
import { panelView } from "../../core/index.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { down, type GroupDetail, type PanelView, renderStage, screenMemo } from "../../orca-plugin/panel/view.ts";
import { type GroupWorld, groupWorld } from "../brief/group-world.ts";
import { bindItem } from "../graph/world.ts";

// Decision 219: the owner's rc.3 panel items (6)(7)(9)-(13).

const LEAD = "api-migration";

async function viewOf(x: GroupWorld, target: { group?: string; item?: string }): Promise<PanelView> {
  const r = panelView(await x.input(), target);
  assert.ok(r.ok, JSON.stringify(r));
  return r.value as unknown as PanelView;
}

const trailOf = (html: string) => [...(/<ol class="trail">(.*?)<\/ol>/s.exec(html)?.[1] ?? "").matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);

test("(6) a decision no gate carries is a broken record row with its id and no answer buttons", async () => {
  const x = await groupWorld();
  x.w.store.append({ type: "decision_opened", source: "decision_open", dedupe_key: "decision:k219", payload: { decision: "d001", decision_key: "k219" } });
  const v = await viewOf(x, {});
  if (v.model.stage !== 1) throw new Error("stage");
  const row = v.model.decisions.rows.find((r) => r.id === "d001");
  assert.ok(row?.broken, JSON.stringify(row));
  assert.match(row.cells[1]?.text ?? "", /기록 깨짐/);
  const html = renderStage(v);
  const tr = /<tr data-id="d001"[^>]*>.*?<\/tr>/s.exec(html)?.[0] ?? "";
  assert.match(tr, /class="broken"/);
  assert.doesNotMatch(tr, /data-act|data-other/, "nothing to answer");
  assert.doesNotMatch(html, /data-for="d001"/, "no answer form either");
});

test("(7) header, tab row, breadcrumb and content share one side gutter", () => {
  const rule = (sel: string) => new RegExp(`(^|\\n)${sel.replace(".", "\\.")} \\{[^}]*`).exec(STYLE)?.[0] ?? "";
  assert.match(rule(".top"), /padding: 0 var\(--gx\);/);
  assert.match(rule(".seg"), /margin: var\(--s2\) var\(--gx\) 0;/);
  assert.match(rule("main"), /padding: var\(--s2\) var\(--gx\) 0;/);
  // The back line sits in the sticky bar under the header (decision 225 (4)): its gutter is padding.
  assert.match(rule(".crumbs"), /padding: var\(--s2\) var\(--gx\);/);
});

test("(9) the trail is left-aligned and back sits at the row's right end", async () => {
  const html = renderStage(await viewOf(await groupWorld(), { group: LEAD }));
  assert.match(html, /<nav class="crumbs"[^>]*><ol class="trail">.*<\/ol><button type="button" class="link back" data-back>‹ 뒤로<\/button><\/nav>/s);
  assert.match(STYLE, /\.crumbs \.back \{[^}]*margin-left: auto;/);
});

test("(11) the trail is where the screen sits, not the clicks that led there", async () => {
  const x = await groupWorld();
  // i052 belongs to docs; the owner reached it from the api-migration screen.
  const stack = down(down([], { group: LEAD }), { item: "i052" });
  assert.equal(stack.length, 2);
  assert.deepEqual(trailOf(renderStage(await viewOf(x, { item: "i052" }))), ["현황", "docs", "i052"]);
  assert.deepEqual(trailOf(renderStage(await viewOf(x, { item: "i031" }))), ["현황", LEAD, "i031"]);
  assert.deepEqual(trailOf(renderStage(await viewOf(x, { group: LEAD }))), ["현황", LEAD]);
});

test("(12) every item the critical path or a why row names is a node of the graph", async () => {
  const x = await groupWorld();
  // A blocked item with no edge: its why row and the critical path name it, as i017 on the owner's screen.
  x.w.task("t17", "run_api");
  bindItem(x.w, "t17", "i017", { lead: LEAD, est: "9" });
  (x.w.tasks.get("t17") as { status: string }).status = "blocked";
  const g = (await viewOf(x, { group: LEAD })).model as GroupDetail;
  const nodes = new Set((g.nodes ?? []).map((n) => n.id));
  const named = new Set([...g.criticalPath, ...g.why.rows.map((r) => r.id), ...g.why.rows.map((r) => r.cells[1]?.text ?? "").filter((p) => /^i\d{3,}$/.test(p))]);
  assert.ok(named.has("i017"), [...named].join(","));
  for (const id of named) assert.ok(nodes.has(id), `${id} is named but not drawn`);
});

test("(13) the seven figure cells wrap evenly in a narrow panel", () => {
  const narrow = /@container panel \(max-width: 719px\) \{(.*)\n\}/s.exec(STYLE)?.[1] ?? "";
  assert.match(narrow, /\.figs \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
});

test("(10) back paints from memory: no reading between the click and the paint", async () => {
  const x = await groupWorld();
  const memo = screenMemo();
  let stack = down([], { group: LEAD });
  const overview = await viewOf(x, {});
  memo.put({}, overview, []);
  // Before decision 219 back waited on a reading: measure that reading on this fixture.
  const input = await x.input();
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) panelView(input, {});
  const read = (performance.now() - t0) / 5;
  memo.put({ group: LEAD }, await viewOf(x, { group: LEAD }), stack);
  stack = [];
  const t1 = performance.now();
  const shown = memo.get({});
  assert.ok(shown, "the overview is still in memory");
  renderStage(shown);
  const fromMemory = performance.now() - t1;
  assert.ok(fromMemory < read, `memory ${fromMemory.toFixed(2)} ms vs a core reading ${read.toFixed(2)} ms (Orca reads not counted)`);
  memo.put({}, overview, stack);
  assert.equal(memo.size, 1, "a screen off the stack is dropped");
  console.log(`# (10) back: core reading ${read.toFixed(2)} ms + Orca reads, from memory ${fromMemory.toFixed(2)} ms`);
});
