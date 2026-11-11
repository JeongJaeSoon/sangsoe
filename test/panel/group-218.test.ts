import assert from "node:assert/strict";
import { test } from "node:test";
import { panelView } from "../../core/index.ts";
import { down, type GroupDetail, type PanelView, renderStage, trail } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "../brief/group-world.ts";

// Decision 218: the 묶음 상세 header, breadcrumb and legend after the owner's S6r feedback.

let group: PanelView;
test.before(async () => {
  const g = panelView(await (await groupWorld()).input(), { group: "api-migration" });
  assert.ok(g.ok);
  group = g.value as unknown as PanelView;
});
const gm = () => group.model as GroupDetail;
const cells = (html: string) => [...html.matchAll(/<div(?: class="[^"]*")?><dt>([^<]*)<\/dt><dd>(\d+)/g)].map((m) => [m[1], Number(m[2])] as const);

test("the title counts open items, the cells before ✅ add up to it, and ✅ comes after them", () => {
  const html = renderStage(group);
  const f = gm().figures;
  assert.ok(f);
  const h1 = /<h1>.*?<\/h1>/s.exec(html)?.[0] ?? "";
  assert.match(h1, new RegExp(`열린 ${f.doing + f.blocked + f.left}건 · 막힘 ${f.blocked}`));
  const names = cells(html).map(([n]) => n);
  assert.deepEqual(names.slice(0, 3), ["🔄 진행 중", "🚧 막힘", "남은 것"]);
  assert.ok(names.indexOf(`✅ ${f.doneDays}일`) > names.indexOf("남은 것"));
  assert.match(html, /<div class="aside"><dt>✅ 7일<\/dt>/);
});

test("a second click on the same row does not push the screen twice", () => {
  const once = down([], { group: "api-migration" });
  assert.deepEqual(down(once, { group: "api-migration" }), once);
  assert.deepEqual(trail(down(once, { group: "api-migration" })), ["현황", "api-migration"]);
});

test("the breadcrumb names the current screen once, not as a link, then the back button at the row's end", () => {
  const html = renderStage(group);
  const nav = /<nav class="crumbs"[^>]*>.*?<\/nav>/s.exec(html)?.[0] ?? "";
  assert.match(nav, /<ol class="trail"><li>현황<\/li><li aria-current="page">api-migration<\/li><\/ol><button type="button" class="link back" data-back>‹ 뒤로<\/button><\/nav>$/);
  assert.equal(nav.split("api-migration").length - 1, 1);
});

test("the edge legend starts folded and opens on a click", () => {
  const html = renderStage(group);
  const legend = /<details class="legend">.*?<\/details>/s.exec(html)?.[0] ?? "";
  assert.match(legend, /^<details class="legend"><summary>간선 종류<\/summary>/);
  assert.match(legend, /stacked_on/);
});
