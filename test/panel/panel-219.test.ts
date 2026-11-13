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
  assert.match(tr, /class="broken[ "]/);
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

// A stand-in for the panel page: just what mount() touches. The click target answers closest() with
// the button it stands for.
function fakePage() {
  const listeners = new Map<string, (ev: unknown) => void>();
  const el = () => ({
    id: "",
    innerHTML: "",
    textContent: "",
    after: () => undefined,
    append: () => undefined,
    addEventListener: (type: string, fn: (ev: unknown) => void) => listeners.set(type, fn),
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
    contains: () => false,
  });
  const root = el();
  const document = {
    head: el(),
    body: el(),
    visibilityState: "visible",
    activeElement: null,
    getElementById: (id: string) => (id === "root" ? root : null),
    createElement: el,
    addEventListener: () => undefined,
  };
  const click = (attr: string, value = "") => {
    const button = { hasAttribute: (a: string) => a === attr, getAttribute: (a: string) => (a === attr ? value : null) };
    listeners.get("click")?.({ target: { closest: (sel: string) => (sel === "a" ? null : button) } });
  };
  return { root, document, click };
}

test("(10) back paints from memory: no reading between the click and the paint", async (t) => {
  const x = await groupWorld();
  const overview = await viewOf(x, {});
  const group = await viewOf(x, { group: LEAD });

  // The pure memo: the overview outlives a step down, and a screen off the stack is dropped.
  const memo = screenMemo();
  memo.put({}, overview, []);
  memo.put({ group: LEAD }, group, down([], { group: LEAD }));
  assert.equal(memo.get({}), overview, "the overview is still in memory");
  memo.put({}, overview, []);
  assert.equal(memo.size, 1, "a screen off the stack is dropped");

  // The panel itself: each panel.brief reading stays pending until the test answers it, and records
  // what the page showed when it was asked for.
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const page = fakePage();
  const reads: { input: unknown; shown: string; answer: (v: PanelView) => void }[] = [];
  const g = globalThis as Record<string, unknown>;
  g.document = page.document;
  g.orca = {
    plugin: {
      request: (name: string, input: unknown) =>
        name === "panel.brief"
          ? new Promise((resolve) => reads.push({ input, shown: page.root.innerHTML, answer: (v) => resolve({ ok: true, value: v }) }))
          : new Promise(() => undefined),
    },
  };
  const settle = () => new Promise((r) => setImmediate(r));
  try {
    await import("../../orca-plugin/panel/index.ts");
    assert.equal(reads.length, 1);
    reads[0]?.answer(overview);
    await settle();
    const first = page.root.innerHTML;
    assert.match(first, /현황/);

    // A screen never read waits on its reading: the control for the claim below.
    page.click("data-nav", JSON.stringify({ group: LEAD }));
    assert.equal(reads.length, 2);
    assert.deepEqual(reads[1]?.input, { group: LEAD });
    assert.equal(page.root.innerHTML, first, "nothing to paint before the group is read");
    reads[1]?.answer(group);
    await settle();
    assert.notEqual(page.root.innerHTML, first);

    page.click("data-back");
    assert.equal(reads.length, 3, "back still asks for a fresh reading");
    assert.equal(reads[2]?.shown, first, "the overview was painted before its reading was asked for");
    assert.equal(page.root.innerHTML, first, "and stays while that reading is out");
  } finally {
    delete g.document;
    delete g.orca;
  }
});
