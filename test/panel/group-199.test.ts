import assert from "node:assert/strict";
import { test } from "node:test";
import { panelView } from "../../core/index.ts";
import { dagLayout, fitText, type GroupDetail, NODE_TEXT_PX, type PanelView, renderStage, textPx } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "../brief/group-world.ts";

// Decision 199: the 묶음 상세 screen drawn to hallmark-final group.html, and the 현황 cues around it.

let group: PanelView;
let overview: PanelView;
test.before(async () => {
  const input = await (await groupWorld()).input();
  const g = panelView(input, { group: "api-migration" });
  const o = panelView(input, {});
  assert.ok(g.ok && o.ok);
  group = g.value as unknown as PanelView;
  overview = o.value as unknown as PanelView;
});
const gm = () => group.model as GroupDetail;
const sectionOf = (html: string, id: string) => html.slice(html.indexOf(`id="h-${id}"`), html.indexOf("</section>", html.indexOf(`id="h-${id}"`)));

test("a lead row says it opens the group: a visible 묶음 상세 › cue and its own label", () => {
  const html = renderStage(overview);
  const lead = /<tr data-id="lead:api-migration"[^>]*>.*?<\/tr>/s.exec(html)?.[0] ?? "";
  assert.match(lead, /aria-label="api-migration 묶음 상세"/);
  assert.match(lead, /<span class="go" aria-hidden="true">묶음 상세 ›<\/span>/);
  assert.doesNotMatch(/<tr data-id="i026"[^>]*>.*?<\/tr>/s.exec(html)?.[0] ?? "", /class="go"/);
});

test("0 groups: 현황 says how a group comes to be, under 진행 중; with groups the line is gone", () => {
  const m = overview.model as Extract<PanelView["model"], { stage: 1 }>;
  const zero = renderStage({ ...overview, model: { ...m, groups: 0, inProgress: { ...m.inProgress, rows: [], count: 0 } } });
  assert.match(zero, /<p class="hint0" data-tab="prog">묶음이 아직 없다\. 묶음은 리드 하나의 일이라, 오케스트레이터가 리드를 띄우면 생기고/);
  assert.doesNotMatch(renderStage(overview), /hint0/);
});

test("완료 최근 7일 folds into a list on 현황 and on the group, one item per done row", () => {
  for (const v of [overview, group]) {
    const html = renderStage(v);
    const fold = /<details class="fold"><summary>✅ 완료 최근 7일 <span class="count">2<\/span><\/summary>(.*?)<\/details>/s.exec(html)?.[1] ?? "";
    assert.equal([...fold.matchAll(/<li>/g)].length, 2, "two rows");
    assert.match(fold, /<span class="id">i024<\/span>인덱스 추가 <a href="https:\/\/github.com\/acme\/api\/pull\/38"/);
  }
});

test("group summary tiles: 우선순위, 7일, 진행, 막힘, 남은 것 with its split, 오너, 플래그", () => {
  const html = renderStage(group);
  const figs = /<dl class="figs"[^>]*>(.*?)<\/dl>/s.exec(html)?.[1] ?? "";
  assert.deepEqual(
    [...figs.matchAll(/<dt>([^<]*)<\/dt>/g)].map((x) => x[1]),
    ["우선순위", "✅ 7일", "🔄 진행 중", "🚧 막힘", "남은 것", "🙋 오너", "🚨 플래그"],
  );
  assert.match(figs, /<dd>7 <small>📅 5, 🟢 2, ⏸️ 0<\/small><\/dd>/);
});

test("최근 전환, 크리티컬 패스 (상태 · 단계 이름), 스택 PR 체인, 릴리스 묶음, 끊긴 선행 and 간선 N are drawn", () => {
  const html = renderStage(group);
  assert.match(sectionOf(html, "recent"), /최근 전환 <span class="count">5<\/span>/);
  assert.match(html, /<h3>크리티컬 패스<\/h3><table class="tbl gt"><thead><tr><th>단계<\/th><th>항목<\/th><th>상태<\/th><th>단계 이름<\/th>/);
  assert.match(html, /<td data-l="단계 이름">deploy_prod, 오너 게이트<\/td>/);
  assert.match(html, /<h3>스택 PR 체인<\/h3>.*<td data-l="층">3층<\/td>/s);
  assert.match(html, /<h3>릴리스 묶음 ship-batch · i001<\/h3>.*<td data-l="단계" class="kind">머지<\/td>/s);
  assert.match(html, /<h3>끊긴 선행<\/h3>.*<tr data-id="i043" class="broken"><td data-l="항목"><span class="id">i043<\/span>후속 테스트 PR/s);
  assert.match(sectionOf(html, "edges"), /간선 <span class="count">11<\/span>/);
});

test("group detail sections follow hallmark group.html: graph, why, edges, then the open items by state, 최근 전환 and 완료", () => {
  const html = renderStage(group);
  const at = (needle: string) => {
    const i = html.indexOf(needle);
    assert.ok(i >= 0, needle);
    return i;
  };
  const order = ['<dl class="figs"', 'id="h-graph"', 'id="h-why"', 'id="h-edges"', 'id="h-s0"', 'id="h-recent"', '<details class="fold">'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const last = gm().sections.length - 1;
  assert.ok(at(`id="h-s${last}"`) < at('id="h-recent"'), "최근 전환 sits right under the state sections");
});

test("왜 준비되지 않았나: 항목 is the item with its title, 막는 선행 is not drawn as the row title", () => {
  const why = sectionOf(renderStage(group), "why");
  assert.doesNotMatch(why, /class="title"/);
  assert.match(why, /<td data-l="항목"><span class="id">i043<\/span>후속 테스트 PR<\/td><td data-l="막는 선행"><span class="id">i027<\/span>캐시 도입<\/td><td data-l="간선 종류" class="kind">blocks<\/td>/);
  assert.match(why, /<tr data-id="i043" class="broken">/);
  const states = [...why.matchAll(/data-l="선행 상태">([^<]*)</g)].map((x) => x[1] ?? "");
  assert.ok(states.length > 0 && states.every((s) => /\p{L}/u.test(s)), `bare marker in 선행 상태: ${states.join(" | ")}`);
});

test("legend: four kinds and the two marks, every cell labelled so a folded row keeps kind and meaning apart", () => {
  const legend = /<div class="legend">(.*?)<\/div>/s.exec(renderStage(group))?.[1] ?? "";
  const rows = [...legend.matchAll(/<tr><td data-l="선 모양">.*?<td data-l="간선"[^>]*>([^<]*)<\/td><td data-l="뜻">/g)].map((x) => x[1]);
  assert.deepEqual(rows, ["blocks", "after", "stacked_on", "deploys_after", "굵은 선", "붉은 점선"]);
});

test("DAG: item boxes carry state and title; a PR predecessor is a reference line, not a box", () => {
  const html = renderStage(group);
  const svg = /<svg class="dag".*?<\/svg>/s.exec(html)?.[0] ?? "";
  assert.match(svg, /<g class="nd s-progress cp" data-node="i026"[^>]*>.*?<text class="n1"[^>]*>i026 🔄 🚨<\/text><text class="n2"[^>]*>N\+1 쿼리 제거<\/text>/s);
  assert.doesNotMatch(svg, /data-node="pr:/);
  assert.match(html, /그림 밖 선행: <code>pr:acme\/api#77<\/code> → i038 \(after\)/);
  const edges = [...svg.matchAll(/<path class="ed [^"]*" data-edge/g)].length;
  assert.equal([...svg.matchAll(/<g class="lb/g)].length, edges, "one label per drawn edge");
  assert.match(svg, /<path class="ed blocks broken" data-edge="i027&gt;i043:blocks"/);
  assert.match(svg, /<g class="lb broken"[^>]*>.*?끊긴 선행/s);
  assert.match(svg, /<marker id="ahb"[^>]*><path class="ahb" d="M1 1L9 5L1 9M5 1V9"\/>/, "the broken arrowhead has its own shape");
});

test("DAG layout: no overlapping boxes or labels, no crossings, long edges pass between boxes, text fits", () => {
  const m = gm();
  const L = dagLayout(m.nodes ?? [], m.edges, m.brokenEdges ?? []);
  const W = 120;
  const H = 40;
  for (const a of L.boxes) {
    for (const b of L.boxes) if (a !== b && a.layer === b.layer) assert.ok(a.x + W <= b.x || b.x + W <= a.x, `${a.id} overlaps ${b.id}`);
  }
  assert.equal(L.crossings, 0);
  for (const [i, a] of L.labels.entries()) {
    for (const b of L.labels.slice(i + 1)) assert.ok(Math.abs(a.x - b.x) * 2 >= a.w + b.w || Math.abs(a.y - b.y) >= 14, `${a.edge} label overlaps ${b.edge}`);
  }
  for (const r of L.routes) {
    for (const p of r.points.slice(1, -1)) {
      for (const b of L.boxes) {
        const inside = p.x > b.x && p.x < b.x + W && p.y >= b.y && p.y <= b.y + H;
        assert.ok(!inside, `${r.edge.pred}>${r.edge.succ} runs through ${b.id}`);
      }
    }
  }
  assert.ok(textPx(fitText("결제 | 환불 모듈을 새 API 로 옮기고 오래된 경로 정리", NODE_TEXT_PX)) <= NODE_TEXT_PX);
  assert.match(fitText("acme-platform-infrastructure/payments-service#1234", NODE_TEXT_PX), /…$/);
});
