import assert from "node:assert/strict";
import { test } from "node:test";
import type { PanelCore } from "../../orca-plugin/core-link.ts";
import { panelHandlers } from "../../orca-plugin/panel/requests.ts";
import { type Band, type Got, PARTS, type PartName, readParts, FOCUS_AFTER, type Reaped, renderResBody, repaint, type ResState, type ResView } from "../../orca-plugin/panel/resources.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";

// Decision 235: the 리소스 section read in three parts that fill in one by one, pinned to the panel's
// bottom with no space of its own under it, and a 6h / 24h band of the load levels.

const AT = "2026-11-14T12:00:00.000Z";
const NOW = Date.parse(AT) + 30_000;
const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();

const band: Band = {
  from: iso(Date.parse(AT) - 24 * H),
  to: AT,
  spans: [
    { from: iso(Date.parse(AT) - 24 * H), to: iso(Date.parse(AT) - 10 * H), state: "unknown" },
    { from: iso(Date.parse(AT) - 10 * H), to: iso(Date.parse(AT) - 3 * H), state: "ok" },
    { from: iso(Date.parse(AT) - 3 * H), to: iso(Date.parse(AT) - 2 * H), state: "danger" },
    { from: iso(Date.parse(AT) - 2 * H), to: AT, state: "ok" },
  ],
};
const parts = {
  load: { part: "load", at: AT, load: { ok: true, value: { level: "ok", reasons: [], loadPerCpu: 0.2, memFreePct: 60, diskFreeGb: 66 } }, episode: { state: "ok", since: AT }, band },
  made: {
    part: "made",
    at: AT,
    made: {
      worktrees: { ok: true, value: { count: 3, kb: 1024 } },
      terminals: { ok: true, value: { count: 4 } },
      processes: { ok: true, value: { claude: { count: 1, kb: 1 }, node: { count: 1, kb: 1 } } },
      tmp: { ok: true, value: { count: 0, kb: 0 } },
    },
  },
  candidates: { part: "candidates", at: AT, worktrees: { ok: true, value: { rows: [], markOnly: false, unseen: [] } }, tmp: { ok: true, value: { count: 0, kb: 0 } }, trash: true },
} as const;
const ok = (p: PartName) => ({ ok: true as const, value: parts[p] as never });

test("reading: each part says what is being read until it comes, and a part that came is drawn at once", () => {
  const none = renderResBody({ kind: "reading", got: {} }, NOW);
  assert.match(none, /<h3>PC 부하<\/h3><p class="pending" role="status">부하를 읽는 중…<\/p>/);
  assert.match(none, /<h3>sangsoe 가 만든 것<\/h3><p class="pending" role="status">worktree·터미널·프로세스·임시 폴더를 읽는 중…<\/p>/);
  assert.match(none, /<h3>정리 후보<\/h3><p class="pending" role="status">끝난 worktree 를 GitHub·Orca 에 묻는 중…<\/p>/);
  const one: Got = { load: ok("load") };
  const html = renderResBody({ kind: "reading", got: one }, NOW);
  assert.match(html, /aria-label="CPU 0\.20 \/ 코어"/, "the load part is drawn");
  assert.doesNotMatch(html, /부하를 읽는 중/);
  assert.match(html, /worktree·터미널·프로세스·임시 폴더를 읽는 중…/);
  assert.doesNotMatch(html, /data-res="ask"/, "nothing to clean up while the candidates are read");
});

test("a refresh keeps the last read in place until each part's new answer comes, with nothing to press", () => {
  const before = { ...parts.load.load.value, loadPerCpu: 0.9 };
  const last = { ...parts.made, ...parts.candidates, ...parts.load, load: { ok: true, value: before }, at: AT } as unknown as ResView;
  const html = renderResBody({ kind: "reading", got: { load: ok("load") }, last }, NOW);
  assert.match(html, /aria-label="CPU 0\.20 \/ 코어"/, "a part that came is drawn fresh");
  assert.doesNotMatch(html, /0\.90/, "the last read never covers a fresh answer");
  assert.doesNotMatch(html, /읽는 중…<\/p>/, "no part drops to a reading row");
  assert.match(html, /<h3>sangsoe 가 만든 것<\/h3><table/);
  assert.match(html, /<h3>정리 후보<\/h3><p class="empty">/);
  assert.doesNotMatch(html, /data-res="(ask|run)"/);
  assert.match(html, /<span class="fresh" aria-live="polite">읽는 중…<\/span>/);

  const result: Reaped = { reaped: ["worktree:inst-a"], blocked: [], skipped: [], tmp: null };
  const after = renderResBody({ kind: "reading", got: {}, last, result }, NOW);
  assert.match(after, /worktree 1건 정리/, "the 정리 outcome shows while the list is read again");
  assert.match(after, /<h3>정리 후보<\/h3><p class="pending"/, "the list from before the 정리 does not stand in");
});

test("the panel asks the three parts together and paints after each; all three in, the view is whole", async () => {
  const asked: unknown[] = [];
  const painted: ResState[] = [];
  const order: PartName[] = ["candidates", "load", "made"];
  const waits = new Map(order.map((p, i) => [p, i]));
  const request = async (input?: unknown) => {
    asked.push(input);
    const p = (input as { part: PartName }).part;
    await new Promise((r) => setTimeout(r, 5 * (2 - (waits.get(p) ?? 0))));
    return ok(p);
  };
  const s = await readParts(request, (x) => painted.push(x));
  assert.deepEqual(asked, PARTS.map((part) => ({ part })), "three requests, sent before any answer");
  assert.equal(painted.length, 3);
  assert.deepEqual(painted.map((x) => (x.kind === "reading" ? Object.keys(x.got).sort() : x.kind)).slice(0, 2), [["made"], ["load", "made"]]);
  assert.equal(s.kind, "shown");
  assert.ok(s.kind === "shown" && s.view.made.worktrees.ok && s.view.band?.spans.length === 4);
});

test("a part that fails is unread in its own block; the others stand", async () => {
  const request = async (input?: unknown) => {
    const p = (input as { part: PartName }).part;
    return p === "candidates" ? { ok: false as const, refusal: { code: "orca_error", reason: "worker-list: runtime_unreachable", fix: "x" } } : ok(p);
  };
  const s = await readParts(request, () => undefined);
  assert.equal(s.kind, "shown");
  if (s.kind !== "shown") return;
  assert.deepEqual(s.view.worktrees, { ok: false, why: "worker-list: runtime_unreachable" });
  assert.equal(s.view.trash, false, "an unread part offers nothing to the trash");
  assert.ok(s.view.load.ok);
});

test("an older core with no parts is read whole, once", async () => {
  const asked: unknown[] = [];
  const whole = { at: AT, load: parts.load.load, episode: parts.load.episode, made: parts.made.made, worktrees: parts.candidates.worktrees, tmp: parts.candidates.tmp, trash: true };
  const request = async (input?: unknown) => {
    asked.push(input ?? "whole");
    if (input) return { ok: false as const, refusal: { code: "core_old", reason: "this core reads the 리소스 section whole", fix: "read it whole" } };
    return { ok: true as const, value: whole };
  };
  const s = await readParts(request, () => undefined);
  assert.deepEqual(asked.filter((a) => a === "whole"), ["whole"]);
  assert.equal(s.kind, "shown");
  assert.ok(s.kind === "shown" && s.view.band === null, "no band from a core that has none");
  assert.doesNotMatch(renderResBody(s, NOW), /class="band"/);
});

test("panel.resources passes a part to the core and refuses anything else", async () => {
  const seen: string[] = [];
  const core = {
    resourcePart: async (p: string) => {
      seen.push(p);
      return { ok: true, value: {} };
    },
    resources: async () => {
      seen.push("whole");
      return { ok: true, value: {} };
    },
  } as unknown as PanelCore;
  const h = panelHandlers(async () => core);
  await h["panel.resources"]({ part: "made" });
  await h["panel.resources"]();
  assert.deepEqual(seen, ["made", "whole"]);
  assert.equal(((await h["panel.resources"]({ part: "all" })) as { ok: boolean }).ok, false);
  const old = panelHandlers(async () => ({ resources: async () => ({ ok: true, value: {} }) }) as unknown as PanelCore);
  assert.equal(((await old["panel.resources"]({ part: "load" })) as { refusal?: { code: string } }).refusal?.code, "core_old");
});

test("band: 6 hours by default, 24 on the switch; danger, ok and unknown each drawn, with what it cannot tell", () => {
  const view = { kind: "shown", view: { ...parts.made, ...parts.candidates, ...parts.load, at: AT } } as unknown as ResState;
  const six = renderResBody(view, NOW);
  assert.match(six, /<button type="button" data-res="h6" aria-pressed="true">6시간<\/button><button type="button" data-res="h24" aria-pressed="false">24시간<\/button>/);
  assert.match(six, /<svg class="band" viewBox="0 0 1000 8" preserveAspectRatio="none" role="img" aria-label="최근 6시간 부하: 위험 1시간, 보통 5시간">/);
  assert.match(six, /<rect class="s-danger" x="500" width="167" height="8"\/>/, "danger from -3h to -2h of six hours");
  assert.match(six, /<span>6시간 전<\/span><span>지금<\/span>/);
  assert.match(six, /단계 변화만 기록된다/);
  const day = renderResBody(view, NOW, 24);
  assert.match(day, /aria-label="최근 24시간 부하: 위험 1시간, 보통 9시간, 모름 14시간"/);
  assert.match(day, /<rect class="s-unknown" x="0" width="583" height="8"\/>/);
  assert.match(day, /<span>24시간 전<\/span><span>지금<\/span>/);
  assert.match(six, /<div class="load-h"><h3>PC 부하 <span class="badge[^"]*">[^<]*<\/span><\/h3><span class="rng"/, "the switch sits beside the heading, so its name stays PC 부하");
});

test("a repaint keeps the keyboard on the button that had it, waits for a disabled one, and takes no focus it did not have", () => {
  const focused: string[] = [];
  // `enabled`: the data-res keys the new paint draws as pressable buttons.
  const el = (inside: boolean, enabled: string[]) => ({
    innerHTML: "",
    contains: () => inside,
    querySelector: (q: string) => {
      const key = /data-res="([^"]+)"\]:not\(:disabled\)$/.exec(q)?.[1] ?? "";
      return enabled.includes(key) ? { focus: () => void focused.push(key) } : null;
    },
  });
  const on = (key: string, tagName = "BUTTON") => ({ tagName, getAttribute: (n: string) => (n === "data-res" ? key : null) }) as unknown as Element;
  const body = on("", "BODY");

  const box = el(true, ["h24"]);
  assert.equal(repaint(box, "<b>new</b>", on("h24")), null);
  assert.equal(box.innerHTML, "<b>new</b>");
  assert.deepEqual(focused, ["h24"]);

  // 새로 고침 is drawn disabled while the read runs: the key waits, focus lands on it when it comes back.
  assert.equal(repaint(el(true, []), "x", on("refresh"), "refresh"), "refresh");
  assert.equal(repaint(el(false, ["refresh"]), "x", body, "refresh"), null);
  assert.deepEqual(focused, ["h24", "refresh"]);

  // 정리… opens the confirm: the press asks for the run button, which is there.
  assert.equal(repaint(el(true, ["run", "cancel"]), "x", on("ask"), FOCUS_AFTER.ask ?? null), null);
  assert.deepEqual(focused, ["h24", "refresh", "run"]);
  assert.deepEqual(FOCUS_AFTER, { ask: "run", cancel: "ask", run: "refresh" });

  assert.equal(repaint(el(false, ["refresh"]), "x", on("other"), "refresh"), null, "focus elsewhere on the page is left alone");
  assert.equal(repaint(el(true, ["h6"]), "x", null), null);
  assert.deepEqual(focused, ["h24", "refresh", "run"]);
});

const rule = (sel: string) => new RegExp(`(?:^|\\n)${sel.replace(/[.()[\]#>:]/g, "\\$&")} \\{[^}]*\\}`).exec(STYLE)?.[0] ?? "";

// These pin the CSS rules; the layout they make is measured in a browser (decision 235, the U102 check).
test("F2 rules: the section is pushed to the panel's bottom when the stage is short, to the page's end when it is long", () => {
  assert.match(rule("body"), /display: flex; flex-direction: column; min-height: 100dvh;/);
  assert.match(rule("#res"), /margin: auto 0 0;/, "pushed down by the free space, nothing under it");
  assert.doesNotMatch(rule("#res"), /position: (fixed|sticky)/, "an open section never gets a scroll of its own");
});

test("F3 rules: the section adds no space of its own below it, and nothing in it scrolls by itself", () => {
  const res = STYLE.slice(STYLE.indexOf("/* The 리소스 section"));
  assert.doesNotMatch(res, /overflow(-y)?: (auto|scroll)/);
  assert.doesNotMatch(rule("#res"), /margin: 0 0 var/, "the section rule's 24px never lands under it");
  assert.match(rule("#root"), /flex: none;/, "the stage keeps its own height above the section");
});
