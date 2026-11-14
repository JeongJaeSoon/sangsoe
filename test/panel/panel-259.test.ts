import assert from "node:assert/strict";
import { test } from "node:test";
import { panelView } from "../../core/index.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { emo, type PanelView, renderStage, stateBadge } from "../../orca-plugin/panel/view.ts";
import { groupWorld } from "../brief/group-world.ts";
import { VIEW } from "../fixtures/panel/rc3-state.ts";

// Decision 259: every emoji+label pair has one gap, from one class and one variable, never from a
// literal space (owner's rc.5 UI point 8: wide after a group title mark, one space elsewhere).

const view = async (target: { group?: string; item?: string }): Promise<PanelView> => {
  const r = panelView(await (await groupWorld()).input(), target);
  assert.ok(r.ok);
  return r.value as unknown as PanelView;
};
const rule = (sel: string) => new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.()[\]"=*+>:]/g, "\\$&")} \\{[^}]*`).exec(STYLE)?.[0] ?? "";
const textOf = (html: string) => html.replace(/<[^>]*>/g, "");
const drawn = (html: string) => html.replace(/<span class="sr"> <\/span>/g, "");
const LITERAL = /\p{Extended_Pictographic}️? +[^\s\p{Extended_Pictographic}]/u;

test("259: emo() takes the space after an emoji into one class and leaves everything else", () => {
  assert.equal(emo("✅ 완료 3건"), '<span class="em">✅<span class="sr"> </span></span>완료 3건');
  assert.equal(emo("⏸️ 보류"), '<span class="em">⏸️<span class="sr"> </span></span>보류');
  assert.equal(emo("완료 ✅ 7일 · 🔄 진행 중"), '완료 <span class="em">✅<span class="sr"> </span></span>7일 · <span class="em">🔄<span class="sr"> </span></span>진행 중');
  assert.equal(emo("오래된 🚧"), "오래된 🚧", "an emoji with no label after it has no gap to set");
  assert.equal(emo("🙋🚨"), "🙋🚨");
  assert.equal(emo("🚧 막힘 &amp; 보류"), '<span class="em">🚧<span class="sr"> </span></span>막힘 &amp; 보류');
  assert.equal(emo("진행 중"), "진행 중");
});

test("259: a screen reader still hears the space after an emoji, and the screen draws none", () => {
  const html = emo("✅ 완료 3건");
  assert.equal(textOf(html), "✅ 완료 3건", "the text keeps the word boundary between the emoji and its label");
  assert.match(html, /<span class="em">✅<span class="sr"> <\/span><\/span>완료 3건/, "the space is visually hidden, so the gap is the variable alone");
});

test("259: no screen draws an emoji and its label apart by a literal space", async () => {
  const pages = [renderStage(VIEW), renderStage(await view({})), renderStage(await view({ group: "api-migration" })), renderStage(await view({ item: "i031" }))];
  for (const html of pages) {
    assert.ok(/\p{Extended_Pictographic}/u.test(textOf(html)), "the page has emoji to check");
    assert.doesNotMatch(textOf(drawn(html)), LITERAL);
  }
  const fold = /<summary>.*?<\/summary>/s.exec(renderStage(VIEW))?.[0] ?? "";
  assert.match(fold, /<span class="em">✅<span class="sr"> <\/span><\/span>완료 최근 7일/);
  assert.match(renderStage(VIEW), /<p class="sumline"><span class="em">✅<span class="sr"> <\/span><\/span>완료 16건 · <span class="em">🔄<span class="sr"> <\/span><\/span>진행 중 0건/);
  assert.doesNotMatch(textOf(drawn(stateBadge("🔄 진행 중 🚨"))), LITERAL);
  assert.match(stateBadge("🔄 진행 중 🚨"), /<span class="badge t-run">진행 중<\/span><span class="sr"> <\/span><span class="fl">🚨<\/span>$/);
});

test("259: the item heading keeps a word boundary after the state marker and before the flags", async () => {
  const html = renderStage(await view({ item: "i031" }));
  const h1 = /<h1>.*?<\/h1>/s.exec(html)?.[0] ?? "";
  assert.match(h1, /<span class="em">[^<]+<span class="sr"> <\/span><\/span><span class="id">/, "the state marker is followed by a hidden space");
  assert.doesNotMatch(textOf(drawn(h1)), LITERAL);
  const flagged: string[] = [];
  for (let n = 1; n <= 120; n++) {
    const id = `i${String(n).padStart(3, "0")}`;
    const r = panelView(await (await groupWorld()).input(), { item: id });
    if (!r.ok) continue;
    const page = renderStage(r.value as unknown as PanelView);
    const head = /<h1>.*?<\/h1>/s.exec(page)?.[0] ?? "";
    if (/class="fl"/.test(head)) flagged.push(head);
  }
  assert.ok(flagged.length > 0, "the world has an item with flags to check");
  for (const head of flagged) assert.match(head, /[^>]<span class="sr"> <\/span><span class="fl">/, "the title is followed by a hidden space before the flags");
});

test("259: one variable sets every gap: the class, the state mark, the flags and a narrow group head", () => {
  assert.equal(STYLE.match(/--emoji-gap:/g)?.length, 1, "defined once");
  assert.match(rule(".em"), /margin-right: var\(--emoji-gap\);/);
  assert.match(rule(".fl"), /margin-left: var\(--emoji-gap\);/);
  assert.match(rule(".tbl tr.lead"), /column-gap: var\(--emoji-gap\);/);
  assert.match(rule(".tbl tr.lead .mk"), /margin-right: 0;/, "the head's gap is the row's, not added twice");
  assert.doesNotMatch(STYLE, /\.mk \+ \.st/, "no second gap between the state mark and its badge");
});

test("259: the state mark is the shared class, and a group row still reads as before", async () => {
  const html = renderStage(await view({}));
  assert.match(html, /<span class="mk em" aria-hidden="true">[^<]+<\/span><span class="badge[^"]*st">/);
  assert.match(html, /aria-label="api-migration 묶음, 막힘, 10건 중 막힘 2, 자세히"/);
});
