import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  type BriefInput,
  type BriefSnapshot,
  decisionOpen,
  type OrcaAdapter,
  type Overview,
  panelCore,
  panelView,
  renderMarkdown,
  type Result,
  readSnapshot,
  renderTodo,
  replayJsonl,
  STATUS_TEXT_MAX,
  statusBarItem,
  type Table,
} from "../../core/index.ts";
import type { PanelCore } from "../../orca-plugin/core-link.ts";
import { openCommand, openHandler, panelHandlers, parseAct, STATUS_UNKNOWN } from "../../orca-plugin/panel/requests.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { back, current, down, drawnRowIds, type PanelView, renderStage, trail } from "../../orca-plugin/panel/view.ts";
import { createWorld } from "../decision/world.ts";
import { ownerWorld } from "../owner/world.ts";

const FIX = new URL("../fixtures/brief/", import.meta.url);
const NOW = "2026-11-10T12:00:00.000Z";
const input: BriefInput = {
  events: replayJsonl(readFileSync(new URL("sample.events.jsonl", FIX), "utf8")),
  orca: JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot,
  now: NOW,
};

const view = (target: { group?: string; item?: string }): PanelView => {
  const r = panelView(input, target);
  assert.ok(r.ok, JSON.stringify(r));
  return r.value as unknown as PanelView;
};
// The first-day panel: every count 0 and every table empty (ref: the owner's screenshot of rc.4).
const emptyOverview = (): PanelView => {
  const one = view({});
  if (one.model.stage !== 1) throw new Error("stage");
  const none = <T extends { rows: unknown[]; count: number }>(t: T): T => ({ ...t, rows: [], count: 0 });
  const m = one.model;
  return {
    todo: [],
    model: {
      ...m,
      groups: 0,
      todo: { total: 0, decisions: 0, other: 0 },
      summary: { done: 0, doing: 0, left: 0, blocked: 0 },
      decisions: none(m.decisions),
      ownerTodo: none(m.ownerTodo),
      inProgress: none(m.inProgress),
      onHold: null,
      evidenceShort: 0,
    },
  };
};
const ids = (...tables: (Table | null)[]) => tables.flatMap((t) => (t ? t.rows.map((r) => r.id) : []));

test("PN2: the panel draws exactly the BriefModel's row ids, in order, at all three stages", () => {
  const one = view({});
  const m1 = one.model as unknown as Overview;
  assert.deepEqual(drawnRowIds(renderStage(one)), ids(m1.decisions, m1.ownerTodo, m1.inProgress, m1.onHold));
  assert.ok(drawnRowIds(renderStage(one)).length > 10);

  const two = view({ group: "api-migration" });
  assert.equal(two.model.stage, 2);
  if (two.model.stage === 2) {
    assert.deepEqual(drawnRowIds(renderStage(two)), [...two.model.sections.flatMap((s) => s.rows.map((r) => r.id)), ...two.model.why.rows.map((r) => r.id)]);
  }

  const three = view({ item: "i031" });
  assert.equal(three.model.stage, 3);
  if (three.model.stage === 3) assert.deepEqual(drawnRowIds(renderStage(three)), three.model.chain.rows.map((r) => r.id));
});

test("PN2: a lead row goes down to its group, an item row to its item; back returns", () => {
  const html = renderStage(view({}));
  const navs = [...html.matchAll(/data-id="([^"]+)"[^>]*data-nav="([^"]+)"/g)].map((m) => [m[1], JSON.parse((m[2] ?? "").replaceAll("&quot;", '"'))]);
  assert.deepEqual(navs.find(([id]) => id === "lead:api-migration")?.[1], { group: "api-migration" });
  assert.deepEqual(navs.find(([id]) => id === "i033")?.[1], { item: "i033" });
  // Every nav target opens: the panel never offers a stage the core cannot build.
  for (const [, t] of navs) assert.ok(panelView(input, t).ok, JSON.stringify(t));

  let stack = down([], { group: "api-migration" });
  stack = down(stack, { item: "i033" });
  assert.deepEqual(current(stack), { item: "i033" });
  assert.deepEqual(trail(stack), ["현황", "api-migration", "i033"]);
  stack = back(back(stack));
  assert.deepEqual([current(stack), trail(stack)], [{}, []]);
  assert.match(renderStage(view({ group: "api-migration" }), ["현황", "api-migration"]), /data-back/);
});

test("buttons follow owner_todo's kind: decisions answer, owner items take 완료, the rest none", () => {
  const one = view({});
  const html = renderStage(one);
  const acts = [...html.matchAll(/data-id="([^"]+)"[\s\S]*?<\/tr>/g)].map((m) => [m[1], [...(m[0] ?? "").matchAll(/data-act="([^"]+)"/g)].map((a) => JSON.parse((a[1] ?? "").replaceAll("&quot;", '"')))]);
  const of = (id: string) => acts.find(([x]) => x === id)?.[1];
  assert.deepEqual(of("d012"), [{ kind: "answer", decision: "d012", choice: "recommended" }]);
  assert.deepEqual(of("i035"), [{ kind: "done", item: "i035" }]);
  assert.deepEqual(of("i032"), [], "a waiting session closes on observed facts, not a button");
  assert.deepEqual(of("d011"), [], "an undelivered answer is redelivered by the start procedure");
  assert.equal(one.todo.find((r) => r.ref === "i035")?.kind, "owner_item");
});

test("the DAG is inline SVG with one path per edge and numbered critical path nodes", () => {
  const two = view({ group: "api-migration" });
  if (two.model.stage !== 2) throw new Error("stage");
  const html = renderStage(two);
  assert.match(html, /<svg class="dag"/);
  assert.equal(html.match(/<path class="ed/g)?.length, two.model.edges.length);
  assert.equal(html.match(/<g class="badge"/g)?.length ?? 0, two.model.criticalPath.length);
});

test("PN3: status bar B reads the same numbers as sangsoe todo and the brief's top lines", () => {
  const r = panelView(input, {});
  assert.ok(r.ok);
  const m = r.value.model as Overview;
  const s = statusBarItem(m);
  assert.equal(s.text, `✨ SANGSOE  🚧 ${m.summary.blocked} · 결정 ${m.todo.decisions} · 🔄 ${m.summary.doing}`);
  assert.equal(s.tone, m.todo.total > 0 ? "danger" : "neutral");
  const md = renderMarkdown(m, { maxWidth: 78 });
  assert.ok(md.includes(`🚧 막힌 것 ${m.summary.blocked}건`) && md.includes(`🔄 진행 중 ${m.summary.doing}건`));
  assert.ok(renderTodo(m).includes(`결정 ${m.todo.decisions}`));
  assert.ok(renderStage(view({})).includes(`내가 할 일 <span>${m.todo.total}</span>`));

  const quiet = statusBarItem({ ...m, todo: { total: 0, decisions: 0, other: 0 } });
  assert.equal(quiet.tone, "neutral");
  const huge = statusBarItem({ ...m, summary: { ...m.summary, blocked: 99999, doing: 99999 }, todo: { ...m.todo, decisions: 99999 } });
  assert.ok(huge.text.length <= STATUS_TEXT_MAX, huge.text);
});

// PANEL_PREVIEW_DIR=<dir> writes each stage as a page for the 360px / wide screenshots (ui-review).
test("preview pages for the screenshots (only with PANEL_PREVIEW_DIR)", { skip: !process.env.PANEL_PREVIEW_DIR }, () => {
  const dir = process.env.PANEL_PREVIEW_DIR ?? "";
  mkdirSync(dir, { recursive: true });
  const stages: [string, PanelView, string[]][] = [
    ["stage1", view({}), []],
    ["stage1-empty", emptyOverview(), []],
    ["stage2", view({ group: "api-migration" }), ["현황", "api-migration"]],
    ["stage3", view({ item: "i031" }), ["현황", "api-migration", "i031"]],
  ];
  for (const [name, v, crumbs] of stages) {
    for (const theme of ["light", "dark"]) {
      for (const [w, width] of [["360", "360px"], ["sidebar", "665px"], ["wide", "1280px"]]) {
        // The script writes the drawn row heights into the page, so `--dump-dom` carries the measurement.
        const measure = `<script>addEventListener("load",()=>{const h=[...document.querySelectorAll("tr[data-id]")].map(r=>Math.round(r.getBoundingClientRect().height));const c={};for(const x of h)c[x]=(c[x]||0)+1;const p=document.createElement("pre");p.id="measure";p.textContent=JSON.stringify({rows:h.length,heights:c,svg:document.querySelectorAll("svg.dag").length});document.body.append(p);});</script>`;
        const page = `<!doctype html><html lang="ko" class="${theme}" data-theme="${theme}"><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div id="root" style="width:${width}">${renderStage(v, crumbs)}</div>${measure}</body></html>`;
        writeFileSync(join(dir, `${name}-${w}-${theme}.html`), page);
      }
    }
  }
});

test("decision 169: header row, stage 1 tabs with model counts, empty sections on one line", () => {
  const one = view({});
  if (one.model.stage !== 1) throw new Error("stage");
  const m = one.model;
  const html = renderStage(one);
  assert.match(html, /<header class="top">.*data-refresh.*data-open=.*<details class="menu">/s);
  assert.match(html, /<main data-view="all">/, "every section shows by default");
  assert.ok(html.includes(`data-tab-to="todo">할 일 <span class="count">${m.todo.total}</span>`));
  assert.ok(html.includes(`data-tab-to="prog">진행 중 <span class="count">${m.inProgress.count}</span>`), "the tab says the section heading's number");
  assert.match(renderStage(one, [], "prog"), /<main data-view="prog">/);
  assert.equal(html.match(/data-tab="todo"/g)?.length, 2, "결정 필요 and 지금 오너가 할 일");

  const empty: PanelView = { ...one, model: { ...m, decisions: { ...m.decisions, rows: [], count: 0 } } };
  const sec = /<section aria-labelledby="h-dec"[^>]*>(.*?)<\/section>/s.exec(renderStage(empty))?.[0] ?? "";
  assert.match(sec, /class="nil"/);
  assert.match(sec, /결정 필요 <span class="count">0<\/span><\/h2><span class="none">없음<\/span>/);
  assert.doesNotMatch(sec, /<table/);

  const two = renderStage(view({ group: "api-migration" }), ["현황", "api-migration"]);
  assert.match(two, /data-back/);
  assert.doesNotMatch(two, /role="tablist"/, "tabs are stage 1's; stages 2 and 3 keep the way back");
});

test("panel.open builds the terminal command itself; panel text never reaches the shell", async () => {
  assert.equal(openCommand({ view: "brief" }), "sangsoe brief");
  assert.equal(openCommand({ view: "brief", group: "api-migration", item: "i033" }), "sangsoe brief api-migration i033");
  assert.equal(openCommand({ view: "brief", item: "i033" }), "sangsoe brief", "an item needs its group");
  assert.equal(openCommand({ view: "brief", group: "a; rm -rf ~" }), "sangsoe brief");
  assert.equal(openCommand({ view: "brief", group: "$(id)" }), "sangsoe brief");
  assert.equal(openCommand({ view: "doctor" }), "sangsoe doctor");
  assert.equal(openCommand({ view: "todo" }), "sangsoe todo");
  for (const bad of [null, {}, { view: "sh" }, { view: "doctor; id" }]) assert.equal(openCommand(bad), null, JSON.stringify(bad));

  const calls: string[][] = [];
  const h = openHandler(async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { ok: true, code: 0, out: "{}", err: "" };
  });
  assert.deepEqual(await h({ view: "doctor" }), { ok: true, value: { status: "opened" } });
  assert.deepEqual(calls[0], ["orca", "terminal", "create", "--worktree", "active", "--title", "sangsoe doctor", "--command", "sangsoe doctor", "--focus", "--json"]);
  assert.equal(((await h({ view: "x" })) as { ok: boolean }).ok, false);
  assert.equal(calls.length, 1, "a refused view runs nothing");
  const failing = openHandler(async () => ({ ok: false, code: 1, out: "", err: "no active worktree" }));
  assert.deepEqual(await failing({ view: "todo" }), { ok: false, refusal: { code: "open_failed", reason: "no active worktree", fix: "run sangsoe todo in a terminal" } });
});

test("parseAct lets through the three button acts only", () => {
  assert.deepEqual(parseAct({ kind: "done", item: "i035" }), { kind: "done", item: "i035" });
  assert.deepEqual(parseAct({ kind: "answer", decision: "d012", text: "  squash " }), { kind: "answer", decision: "d012", text: "squash" });
  for (const bad of [null, {}, { kind: "done", item: "d1" }, { kind: "answer", decision: "i012", choice: "recommended" }, { kind: "answer", decision: "d012", text: " " }]) {
    assert.equal(parseAct(bad), null, JSON.stringify(bad));
  }
});

const RUN = "run_000000000001";
const T1 = "task_000000000001";

/**
 * The brief input comes the way the worker reads it: readSnapshot on the fake Orca, whose gate-list
 * returns each gate's options as the JSON text real Orca does. `unreadable` and `blank-first` replace that text.
 */
async function world(how: "options" | "no-options" | "unreadable" | "blank-first" = "options") {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001", title: "webhook retry" }]);
  const opened = await decisionOpen(w, {
    subject: "item:i012",
    question: "Retry policy?",
    options: how === "no-options" ? [] : ["exponential x3", "none"],
    waiters: [{ task: T1, run: RUN }],
    callerRun: RUN,
  });
  assert.ok(opened.ok, JSON.stringify(opened));
  const text = { unreadable: "exponential x3, none", "blank-first": JSON.stringify(["  ", "none"]) }[how as string];
  if (text) for (const g of w.gates.values()) g.options = text;
  const load = async (now: string): Promise<Result<BriefInput>> => {
    const snap = await readSnapshot(w.orca, [RUN]);
    return snap.ok ? { ok: true, value: { events: w.store.events(), orca: snap.value, now } } : snap;
  };
  const core = panelCore({ orca: w.orca, withStore: (fn) => fn(w.store), now: () => NOW, load });
  return { w, core };
}

async function recommendButton(core: PanelCore): Promise<string> {
  const b = await core.brief({});
  assert.ok(b.ok, JSON.stringify(b));
  const html = renderStage(b.value as unknown as PanelView);
  const button = /<button[^>]*>추천대로 답/.exec(html)?.[0];
  assert.ok(button, "the decision row has a 추천대로 답 button");
  return button;
}

test("PN4 live: 추천대로 답 is enabled when Orca's gate has options, and the first is the recommendation", async () => {
  const { w, core } = await world("options");
  assert.doesNotMatch(await recommendButton(core), /disabled/);
  assert.ok(!JSON.stringify(w.store.events()).includes("exponential x3"), "the options stay Orca's: the store keeps no copy");
});

for (const how of ["no-options", "unreadable", "blank-first"] as const) {
  test(`PN4 live: 추천대로 답 is disabled and refused when the gate's options are ${how}; nothing is written`, async () => {
    const { w, core } = await world(how);
    assert.match(await recommendButton(core), /disabled/);
    const r = await core.act({ kind: "answer", decision: "d001", choice: "recommended" });
    assert.deepEqual(r.ok ? null : r.refusal.code, "no_recommendation");
    assert.equal(w.store.events({ type: "owner_action" }).length, 0);
  });
}

test("PN4 live: 추천대로 답 → owner_action{button} → decisionAnswer, the same function the CLI and MCP call", async () => {
  const { w, core } = await world("options");
  const r = await core.act({ kind: "answer", decision: "d001", choice: "recommended" });
  assert.ok(r.ok, JSON.stringify(r));
  const action = w.store.events({ type: "owner_action" });
  assert.deepEqual(action.map((e) => [e.source, e.payload.origin, e.payload.summary]), [["plugin:panel", "button", "d001 exponential x3"]]);
  const answered = w.store.events({ type: "decision_answered" });
  assert.deepEqual(answered.map((e) => [e.payload.answer, e.payload.linked_by, e.payload.owner_action]), [["exponential x3", "button", action[0]?.seq]]);
  // The panel holds no Run: the open gate goes to the Run holding it, not resolved from here.
  assert.equal(w.calls("orchestration gate-resolve").length, 0);
  assert.deepEqual(r.ok && "handedOff" in r.value ? r.value.handedOff : null, [T1]);
  assert.equal(w.sends[0]?.to, `run:${RUN}`);
});

test("PN4 live: 다른 답 sends the typed words to the Run holding the gate", async () => {
  const { w, core } = await world();
  const r = await core.act({ kind: "answer", decision: "d001", text: "linear x5" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(w.store.events({ type: "decision_answered" })[0]?.payload.answer, "linear x5");
  assert.equal(w.sends[0]?.to, `run:${RUN}`);
});

test("PN4: 완료 → U14 ownerDone closes a 🟢 owner item in Orca and the store; anything else is refused", async () => {
  const o = ownerWorld();
  const mine = o.item("task_000000000010", { who: "owner" });
  const theirs = o.item("task_000000000011", { who: "acme-bot" });
  const core = panelCore({ orca: o.orca as unknown as OrcaAdapter, withStore: (fn) => fn(o.store), now: () => o.now, load: async () => ({ ok: true, value: o.input() }) });

  const no = await core.act({ kind: "done", item: theirs });
  assert.equal(no.ok ? null : no.refusal.code, "not_owner_item");
  assert.equal(o.store.events({ type: "owner_action" }).length, 0, "a refused 완료 records nothing");

  const r = await core.act({ kind: "done", item: mine });
  assert.deepEqual(r.ok ? r.value : r, { status: "done", item: mine, evidenceShort: false });
  assert.equal(o.state("task_000000000010"), "done");
  assert.deepEqual(o.store.events({ type: "owner_action" }).map((e) => [e.source, e.payload.origin]), [["plugin:panel", "button"]]);
  assert.equal(o.store.events({ type: "item_transition" })[0]?.payload.reason, "owner_done");
});

test("다른 답 is masked before it is stored or handed to the Run", async () => {
  const { w, core } = await world();
  const secret = `ghp_${"a1B2c3D4e5".repeat(4)}`;
  const r = await core.act({ kind: "answer", decision: "d001", text: `use ${secret}` });
  assert.ok(r.ok, JSON.stringify(r));
  const seen = JSON.stringify([w.store.events(), w.sends]);
  assert.ok(!seen.includes(secret), "the token reached the store or a send");
  assert.match(String(w.store.events({ type: "decision_answered" })[0]?.payload.answer), /^use /);
});

test("a core that throws becomes a refusal and status falls back to '✨ SANGSOE  ?'", async () => {
  const boom = async () => {
    throw new Error("disk gone");
  };
  const h = panelHandlers(async () => ({ brief: boom, act: boom, statusBar: boom }) as unknown as PanelCore);
  assert.deepEqual(await h["panel.brief"]({}), { ok: false, refusal: { code: "core_error", reason: "disk gone", fix: "reopen the panel; run sangsoe doctor if it repeats" } });
  const a = await h["panel.act"]({ kind: "done", item: "i035" });
  assert.equal(a.ok ? null : a.refusal.code, "core_error");
  const s = await h.status();
  assert.equal(s.text, STATUS_UNKNOWN.text);

  let tries = 0;
  const later = panelHandlers(async () => (++tries === 1 ? "no build yet" : ({ statusBar: async () => ({ ok: true, value: { text: "🚧0 · 결정0 · 🔄0", tone: "neutral", tooltip: "" } }) } as unknown as PanelCore)));
  assert.equal((await later.status()).text, STATUS_UNKNOWN.text);
  assert.equal((await later.status()).text, "🚧0 · 결정0 · 🔄0", "a failed load is tried again");
});

test("no row is painted by its state (decision 92①): only lead rows and hover shade", () => {
  assert.doesNotMatch(STYLE, /tr\.own|--bad-soft|background:\s*var\(--bad/);
  const shaded = [...STYLE.matchAll(/([^{}]*)\{[^}]*background:\s*var\(--paper/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter((sel) => /(?:^|[\s>])(?:\.\w+\s+)*(tr|td)\b[^\s]*$/.test(sel));
  assert.ok(shaded.length >= 2, "the check sees the lead and hover rules");
  for (const sel of shaded) assert.match(sel, /tr\.lead|tr:hover/, sel);
});
