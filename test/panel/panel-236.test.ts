// Decision 236 on the panel: the footer counts 근거 부족 and 리뷰만 있음 apart, and a model from a core
// that predates the second number draws only the first.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type BriefInput, type BriefSnapshot, panelView, replayJsonl } from "../../core/index.ts";
import { type PanelView, renderStage } from "../../orca-plugin/panel/view.ts";

const FIX = new URL("../fixtures/brief/", import.meta.url);
const input: BriefInput = {
  events: replayJsonl(readFileSync(new URL("sample.events.jsonl", FIX), "utf8")),
  orca: JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot,
  now: "2026-11-10T12:00:00.000Z",
};
const foot = (v: PanelView) => /<p class="foot">.*?<\/p>/s.exec(renderStage(v))?.[0] ?? "";

test("the footer shows 🔍 근거 부족 and 👀 리뷰만 있음 as two numbers", () => {
  const r = panelView(input, {});
  assert.ok(r.ok, JSON.stringify(r));
  const v = r.value as unknown as PanelView;
  assert.match(foot(v), /<span class="em">🔍<span class="sr"> <\/span><\/span>근거 부족 1 · <span class="em">👀<span class="sr"> <\/span><\/span>리뷰만 있음 0 · 상세/);

  if (v.model.stage !== 1) throw new Error("stage");
  const { reviewOnly: _, ...older } = v.model;
  assert.match(foot({ ...v, model: older }), /<span class="em">🔍<span class="sr"> <\/span><\/span>근거 부족 1 · 상세/, "an older core's model");
});
