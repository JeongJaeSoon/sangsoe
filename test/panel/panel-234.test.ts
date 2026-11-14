import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type OwnerReap, type OwnerReaped, panelCore, panelView, type ResourceView, Store } from "../../core/index.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { CHEV, type PanelView, renderStage } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "../brief/group-world.ts";
import type { PanelCore } from "../../orca-plugin/core-link.ts";
import { panelHandlers, parseReap } from "../../orca-plugin/panel/requests.ts";
import { type ResView, reapTargets, renderResBody, renderResources, STALE_MS } from "../../orca-plugin/panel/resources.ts";

// Decision 234: the 리소스 fold at the panel's bottom, its states, and the confirm-then-run 정리.

const AT = "2026-11-13T03:00:00.000Z";
const NOW = Date.parse(AT) + 60_000;

const view = (o: Partial<ResView> = {}): ResView => ({
  at: AT,
  load: { ok: true, value: { level: "warn", reasons: ["load/CPU 1.50 ≥ 경고 1.3"], loadPerCpu: 1.5, memFreePct: 40, diskFreeGb: 120 } },
  episode: { state: "high", since: AT, reason: "warn: load/CPU 1.50" },
  made: {
    worktrees: { ok: true, value: { count: 3, kb: 3 * 1024 * 1024 } },
    terminals: { ok: true, value: { count: 4 } },
    processes: { ok: true, value: { claude: { count: 5, kb: 800 * 1024 }, node: { count: 12, kb: 1024 } } },
    tmp: { ok: true, value: { count: 13_201, kb: 95 * 1024 } },
  },
  worktrees: {
    ok: true,
    value: {
      rows: [
        { ref: "inst-a", name: "acme-u12", path: "/w/a", gone: false, state: "finished", why: "PR #12", kb: 2048 },
        { ref: "inst-b", name: "smoke-1", path: "/w/b", gone: true, state: "unknown", why: "no HEAD", kb: 0 },
      ],
      markOnly: false,
      unseen: [],
    },
  },
  tmp: { ok: true, value: { count: 13_000, kb: 90 * 1024 } },
  trash: true,
  ...o,
});

// PANEL_PREVIEW_DIR=<dir> writes the overview without and with the fold, closed, open and confirming,
// for the headless renders at 600 / 900 / 1200px (ui-review). The page script records overflow.
test("preview pages for the screenshots (only with PANEL_PREVIEW_DIR)", { skip: !process.env.PANEL_PREVIEW_DIR }, async () => {
  const dir = process.env.PANEL_PREVIEW_DIR ?? "";
  mkdirSync(dir, { recursive: true });
  const w = await groupWorld();
  const one = panelView(await w.input(), {});
  assert.ok(one.ok);
  const stage = renderStage(one.value as unknown as PanelView);
  // ui-review checks on the fold: horizontal-overflow, row-height, vertical-center (gauge rows), value-wrap.
  const measure = `<script>addEventListener("load",()=>{const r=document.getElementById("res");const q=(s)=>r?[...r.querySelectorAll(s)]:[];const box=(e)=>e.getBoundingClientRect();const out=q("*").filter(e=>box(e).right>box(r).right+0.5).map(e=>e.className||e.tagName);const rows={};for(const t of q("tbody tr")){const h=Math.round(box(t).height);rows[h]=(rows[h]||0)+1;}const off=q(".gauge").map(g=>{const c=[...g.children].map(x=>{const b=box(x);return b.top+b.height/2;});return Math.round(Math.max(...c)-Math.min(...c));});const wrapped=q("td.num,.g-v,.g-l").filter(e=>box(e).height>34&&e.tagName!=="TD"||e.tagName==="TD"&&e.scrollHeight>36).length;const clipped=q("td.num").filter(e=>e.scrollWidth>e.clientWidth).map(e=>e.textContent);const p=document.createElement("pre");p.id="measure";p.textContent=JSON.stringify({pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,resOverflow:out,rowHeights:rows,gaugeCenterOff:off,wrapped,clipped});document.body.append(p);});</script>`;
  const cases: [string, string][] = [
    ["before", ""],
    ["closed", renderResources({ kind: "idle" }, false, NOW)],
    ["open", renderResources({ kind: "shown", view: view() }, true, NOW)],
    ["confirm", renderResources({ kind: "shown", view: view(), confirm: true }, true, NOW)],
  ];
  for (const [name, res] of cases) {
    for (const width of [390, 600, 900, 1200]) {
      const section = res ? `<section id="res">${res}</section>` : "";
      const page = `<!doctype html><html lang="ko" class="light"><head><meta charset="utf-8"><style>${STYLE}</style></head><body style="width:${width}px;margin:0"><div id="root">${stage}</div>${section}${measure}</body></html>`;
      writeFileSync(join(dir, `res-${name}-${width}.html`), page);
    }
  }
});

test("the fold is closed by default and reads nothing until opened", () => {
  const html = renderResources({ kind: "idle" }, false, NOW);
  assert.equal(html, `<details class="fold res-fold"><summary>리소스${CHEV}</summary><div class="res-body"></div></details>`);
  assert.match(renderResources({ kind: "shown", view: view() }, true, NOW), /<details class="fold res-fold" open>/);
});

test("open: load gauges and the candidates with why; the counts of what sangsoe made are not drawn (decision 248)", () => {
  const html = renderResBody({ kind: "shown", view: view() }, NOW);
  assert.match(html, /PC 부하 <span class="badge t-run">경고<\/span>/);
  assert.match(html, /aria-label="CPU 1\.50 \/ 코어"><i class="t-warn" style="width:75%">/);
  assert.match(html, /aria-label="메모리 여유 40%"><i class="" style="width:40%">/);
  assert.match(html, /부하 높음: warn: load\/CPU 1\.50/);
  assert.doesNotMatch(html, /sangsoe 가 만든 것|<td>worktree<\/td>|13,201/);
  assert.match(html, /title="acme-u12: \/w\/a">acme-u12<\/td><td title="끝남 \(PR #12\)">끝남 \(PR #12\)<\/td><td class="num">2\.0 MB/);
  assert.match(html, /smoke-1<\/td><td title="경로 없음: 등록만 지움">경로 없음: 등록만 지움<\/td>/);
  assert.match(html, /임시 폴더 13,000개<\/td>/);
  assert.match(html, /data-res="ask">정리…<\/button>/);
  assert.doesNotMatch(html, /data-res="run"/, "nothing runs on the first press");
});

test("the second step lists the count and runs only from its own button; cancel is beside it", () => {
  const html = renderResBody({ kind: "shown", view: view(), confirm: true }, NOW);
  assert.match(html, /위 3건을 정리한다/);
  assert.match(html, /<button type="button" class="btn primary" data-res="run">3건 정리<\/button><button type="button" class="btn" data-res="cancel">취소<\/button>/);
  assert.match(renderResBody({ kind: "shown", view: view(), confirm: true, running: true }, NOW), /data-res="run" disabled/);
  assert.deepEqual(reapTargets(view()), { worktrees: ["inst-a", "inst-b"], tmp: true });
});

test("no reaper config or no trash command: those kinds are listed but never sent", () => {
  const base = view().worktrees;
  const v = view({ worktrees: { ok: true, value: { rows: base.ok ? base.value.rows : [], markOnly: true, unseen: [] } }, trash: false });
  assert.deepEqual(reapTargets(v), { worktrees: [], tmp: false });
  const html = renderResBody({ kind: "shown", view: v }, NOW);
  assert.match(html, /reaper 설정이 없어/);
  assert.match(html, /휴지통 명령\(trash\)이 없어/);
  assert.doesNotMatch(html, /data-res="ask"/);
});

test("reading, empty, failed, unread and stale each say so; an unread count is never 0", () => {
  assert.match(renderResBody({ kind: "reading", got: {} }, NOW), /읽는 중…/);
  const empty = view({ worktrees: { ok: true, value: { rows: [], markOnly: false, unseen: [] } }, tmp: { ok: true, value: { count: 0, kb: 0 } } });
  assert.match(renderResBody({ kind: "shown", view: empty }, NOW), /<p class="empty">정리할 것 없음<\/p>/);
  assert.match(renderResBody({ kind: "failed", refusal: { code: "core_old", reason: "x", fix: "y" } }, NOW), /리소스를 읽지 못했다\. <button type="button" class="link" data-res="refresh">/);
  const unread = view({ made: { ...view().made, worktrees: { ok: false, why: "worktree list: runtime_unreachable" } }, worktrees: { ok: false, why: "worktree list" } });
  const html = renderResBody({ kind: "shown", view: unread }, NOW);
  assert.match(html, /<h3>기록됨·오너 손<\/h3><p class="ep"><span class="unread" title="worktree list: runtime_unreachable">읽지 못함<\/span><\/p>/, "a made part with no list says it was not read");
  assert.match(html, /하나라도 못 읽으면 worktree 는 정리하지 않는다/);
  assert.doesNotMatch(renderResBody({ kind: "shown", view: view() }, NOW), /낡음/);
  assert.match(renderResBody({ kind: "shown", view: view() }, Date.parse(AT) + STALE_MS + 1), /읽음, 낡음/);
});

test("U133: a candidate read that failed is never summed up as nothing to clean", () => {
  const ok = { ok: true as const, value: { rows: [], markOnly: false, unseen: [] } };
  const none = { ok: true as const, value: { count: 0, kb: 0 } };
  const wt = renderResBody({ kind: "shown", view: view({ worktrees: { ok: false, why: "open PRs of acme/api" }, tmp: none }) }, NOW);
  assert.doesNotMatch(wt, /정리할 것 없음/);
  assert.match(wt, /class="empty">[^<]*worktree 후보[^<]*알 수 없음/);
  const tmp = renderResBody({ kind: "shown", view: view({ worktrees: ok, tmp: { ok: false, why: "/tmp: EACCES" } }) }, NOW);
  assert.doesNotMatch(tmp, /정리할 것 없음/);
  assert.match(tmp, /class="empty">[^<]*임시 폴더[^<]*알 수 없음/);
  assert.match(renderResBody({ kind: "shown", view: view({ worktrees: ok, tmp: none }) }, NOW), /정리할 것 없음/, "all read, none found still says so");
});

test("a stale reading cannot be confirmed, and refresh waits while a 정리 runs", () => {
  const late = Date.parse(AT) + STALE_MS + 1;
  for (const confirm of [false, true]) {
    const html = renderResBody({ kind: "shown", view: view(), confirm }, late);
    assert.doesNotMatch(html, /data-res="(ask|run)"/);
    assert.match(html, /새로 고친 뒤 정리한다/);
  }
  assert.match(renderResBody({ kind: "shown", view: view(), confirm: true, running: true }, NOW), /data-res="refresh" disabled/);
  assert.doesNotMatch(renderResBody({ kind: "shown", view: view() }, NOW), /data-res="refresh" disabled/);
});

test("one 정리 sends at most as many cards as panel.reap accepts, and says the rest wait", () => {
  const rows = Array.from({ length: 201 }, (_, i) => ({ ref: `inst-${i}`, name: `n${i}`, path: `/w/${i}`, gone: false, state: "finished", why: "PR #1", kb: 1 }));
  const v = view({ worktrees: { ok: true, value: { rows, markOnly: false, unseen: [] } } });
  const t = reapTargets(v);
  assert.equal(t.worktrees.length, 200);
  assert.ok(parseReap(t), "the handler takes what the panel sends");
  const html = renderResBody({ kind: "shown", view: v, confirm: true }, NOW);
  assert.match(html, /data-res="run">201건 정리</, "200 worktrees and the temp folders");
  assert.match(html, /한 번에 worktree 200건까지 정리한다\. 나머지 1건은 다음 정리에서\./);
});

test("the result counts only worktrees as worktrees", () => {
  const html = renderResBody({ kind: "shown", view: view(), result: { reaped: ["worktree:inst-a", "container:c1"], blocked: [], skipped: [], tmp: null } }, NOW);
  assert.match(html, />worktree 1건 정리, Docker 1건 정리</);
});

test("the result of a 정리 shows right away, with the blocked ones in its title", () => {
  const html = renderResBody(
    { kind: "shown", view: view(), result: { reaped: ["worktree:inst-a"], blocked: [{ kind: "worktree", ref: "inst-b", reason: "uncommitted" }], skipped: [], tmp: { moved: 13_000, left: 0 } } },
    NOW,
  );
  assert.match(html, /<p class="msg" role="status" title="inst-b: 커밋 안 된 변경">worktree 1건 정리, 임시 폴더 13,000개 휴지통으로, 막힘·건너뜀 1건<\/p>/);
});

test("panel.reap takes only listed-looking ids and a boolean; anything else never reaches the core", async () => {
  assert.deepEqual(parseReap({ worktrees: ["inst-a", "inst-a"], tmp: true }), { worktrees: ["inst-a"], tmp: true });
  for (const bad of [null, {}, { worktrees: [] }, { worktrees: ["a b"] }, { worktrees: "inst-a" }, { worktrees: ["x"], tmp: "yes" }, { worktrees: Array(201).fill("a") }]) {
    assert.equal(parseReap(bad), null, JSON.stringify(bad));
  }
  let reached = 0;
  const core = {
    reap: async () => {
      reached++;
      return { ok: true, value: {} };
    },
  } as unknown as PanelCore;
  const h = panelHandlers(async () => core);
  assert.equal(((await h["panel.reap"]({ worktrees: ["; rm"] })) as { ok: boolean }).ok, false);
  assert.equal(reached, 0);
  assert.equal(((await h["panel.reap"]({ tmp: true })) as { ok: boolean }).ok, true);
  const old = panelHandlers(async () => ({}) as PanelCore);
  assert.deepEqual(await old["panel.resources"](), { ok: false, refusal: { code: "core_old", reason: "this core has no resource read", fix: "update sangsoe" } });
});

test("the core records the owner's press as an owner_action before the confirmed 정리 runs", async () => {
  const store = Store.open({ path: ":memory:" });
  const order: string[] = [];
  const core = panelCore({
    orca: {} as never,
    now: () => AT,
    withStore: async (fn) => {
      order.push("record");
      return fn(store);
    },
    resources: {
      read: async () => ({}) as ResourceView,
      reap: async (a: OwnerReap) => {
        order.push(`reap ${a.worktrees.join(",")} ${a.tmp}`);
        return { reaped: [], blocked: [], skipped: [], tmp: null } as OwnerReaped;
      },
    },
  });
  assert.equal((await core.reap({ worktrees: [], tmp: false })).ok, false);
  assert.ok((await core.reap({ worktrees: ["inst-a"], tmp: true })).ok);
  assert.deepEqual(order, ["record", "reap inst-a true"]);
  const rows = store.events({ type: "owner_action" });
  assert.equal(rows.length, 1);
  assert.equal((rows[0]?.payload as { origin?: string } | undefined)?.origin, "button");
});
