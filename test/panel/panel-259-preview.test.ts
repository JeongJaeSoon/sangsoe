import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { renderStage } from "../../orca-plugin/panel/view.ts";
import { VIEW } from "../fixtures/panel/rc3-state.ts";

// PANEL_PREVIEW_DIR=<dir> writes 현황 on the generic rc.3 fixture at 455 and 900px, with the folded 완료
// list opened and closed, for a before/after capture of the emoji gaps (decision 259). It imports only
// what main already exports, so the same file runs on the base.
test("preview pages for the emoji gap (only with PANEL_PREVIEW_DIR)", { skip: !process.env.PANEL_PREVIEW_DIR }, () => {
  const dir = process.env.PANEL_PREVIEW_DIR ?? "";
  mkdirSync(dir, { recursive: true });
  const stage = renderStage(VIEW);
  for (const width of [455, 900]) {
    const page = `<!doctype html><html lang="ko" class="light"><head><meta charset="utf-8"><style>${STYLE}</style></head><body style="width:${width}px;margin:0"><div id="root">${stage}</div></body></html>`;
    writeFileSync(join(dir, `gap-${width}.html`), page);
  }
});
