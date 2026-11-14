import assert from "node:assert/strict";
import { test } from "node:test";
import { renderResources } from "../../orca-plugin/panel/resources.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { renderStage } from "../../orca-plugin/panel/view.ts";
import { VIEW } from "../fixtures/panel/rc3-state.ts";

// Decision 253: the fold arrow became an svg so it can be centred and measured. A screen reader still
// learns open and closed from the native details/summary pair alone, and hears only the title.

const summaries = (html: string) => [...html.matchAll(/<details class="fold[^"]*"( open)?><summary>(.*?)<\/summary>/gs)].map((m) => m[2] ?? "");

test("253: a fold's state stays the native details/summary pair; the arrow is hidden and says nothing", () => {
  const folds = [
    ...summaries(renderResources({ kind: "idle" }, false, 0)),
    ...summaries(renderResources({ kind: "idle" }, true, 0)),
    ...summaries(renderStage(VIEW)),
  ];
  assert.ok(folds.length >= 3, "the 리소스 fold closed and open, and the 완료 fold");
  for (const s of folds) {
    const arrow = /<svg class="chev"[^>]*>.*<\/svg>$/s.exec(s)?.[0] ?? "";
    assert.match(arrow, /aria-hidden="true"/, "the arrow ends the summary and is hidden");
    assert.doesNotMatch(arrow, /<title|<text|role=|tabindex/, "nothing in it is read or focused");
    assert.doesNotMatch(s, /aria-expanded|role=/, "no second way to say open or closed");
  }
  assert.doesNotMatch(STYLE, /summary::after/, "no generated glyph is read after the title");
});
