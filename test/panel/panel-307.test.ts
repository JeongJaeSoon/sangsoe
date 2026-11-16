import assert from "node:assert/strict";
import { test } from "node:test";
import { focusAfter, RES_OPEN_KEY, renderResBody, STALE_MS, wantOnFocus } from "../../orca-plugin/panel/resources.ts";
import { PARTS_GOT } from "../fixtures/panel/rc3-state.ts";
import { scratchDir } from "../scratch.ts";
import { dump, noBrowser, orcaPage, transpilePanel } from "./browser.ts";

// Decision 307: three edges of the 리소스 section's focus and reread (an earlier held maintenance item).

const el = (res: string | null) => ({ getAttribute: (n: string) => (n === "data-res" && res !== null ? res : null) }) as unknown as Element;

test("307: a waiting press survives focus on its own button or target, and ends on any other focus", () => {
  const want = { from: "refresh", to: "refresh" };
  assert.equal(wantOnFocus(want, el("refresh")), want);
  assert.equal(wantOnFocus({ from: "run", to: "refresh" }, el("run")) !== null, true);
  assert.equal(wantOnFocus(want, el(null)), null, "the body region, or anything outside the section, has no data-res");
  assert.equal(wantOnFocus(want, el("h24")), null);
  assert.equal(wantOnFocus(want, null), null);
  assert.equal(wantOnFocus(null, el("refresh")), null);
});

test("307: 취소 lands on 새로 고침 in a stale view, where no 정리… button is drawn", () => {
  assert.equal(focusAfter("cancel", false), "ask");
  assert.equal(focusAfter("cancel", true), "refresh");
  assert.equal(focusAfter("ask", true), "run");
  assert.equal(focusAfter("refresh", false), "refresh");
});

test("307: a failed read keeps the 정리 result above the failure line", () => {
  const result = { reaped: ["worktree:a", "worktree:b"], blocked: [], skipped: [], tmp: null };
  const failed = { kind: "failed" as const, refusal: { code: "orca_error", reason: "x", fix: "x" } };
  assert.ok(!renderResBody(failed, 0).includes("정리"));
  const html = renderResBody({ ...failed, result }, 0);
  assert.ok(html.indexOf("worktree 2건 정리") >= 0 && html.indexOf("worktree 2건 정리") < html.indexOf("리소스를 읽지 못했다"));
});

const ROW = { ref: "inst-a", name: "acme-api-old", path: "/w/acme-api-old", gone: false, state: "finished", why: "PR merged", kb: 2048 };

const bridge = `<script>
const realNow = Date.now;
window.skew = 0;
Date.now = () => realNow() + window.skew;
const base = ${JSON.stringify(PARTS_GOT)};
const row = ${JSON.stringify(ROW)};
const store = new Map([["res.open", true]]);
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
window.readsFail = false;
window.readMs = 50;
Object.defineProperty(window, "orca", { value: Object.freeze({
  plugin: Object.freeze({
    request: (name, input) => {
      if (name === "panel.brief") return later(10, { ok: false, refusal: { code: "x", reason: "x", fix: "x" } });
      if (name === "panel.reap") return later(10, { ok: true, value: { reaped: ["worktree:inst-a"], blocked: [], skipped: [], tmp: null } });
      if (name !== "panel.resources") return later(10, { ok: false, refusal: { code: "x", reason: "x", fix: "x" } });
      if (window.readsFail) return later(window.readMs, { ok: false, refusal: { code: "orca_error", reason: "x", fix: "x" } });
      const r = structuredClone(base[input.part]);
      r.value.at = new Date().toISOString();
      if (input.part === "candidates") r.value.worktrees.value.rows = [row];
      return later(window.readMs, r);
    },
    on: () => undefined,
  }),
  storage: Object.freeze({ get: async (k) => store.get(k) ?? null, set: async () => {} }),
}) });
</script>\n`;

const run = (steps: Record<number, string>, resKey: string): Record<string, unknown> => {
  const dir = scratchDir("sangsoe-307-");
  transpilePanel(dir);
  const entry = '<script type="module" src="./orca-plugin/panel/index.js"></script>\n';
  const code = `<script>
window.out = {};
const res = () => document.getElementById("res");
const body = () => res().querySelector(".res-body");
const btn = (w) => res().querySelector('[data-res="' + w + '"]');
const active = () => document.activeElement?.getAttribute("data-res") ?? document.activeElement?.className ?? document.activeElement?.tagName;
addEventListener("load", () => {
${Object.entries(steps)
  .map(([t, c]) => `  setTimeout(() => { ${c} }, ${t});`)
  .join("\n")}
});
</script>\n`;
  const page = orcaPage(bridge.replace('"res.open"', JSON.stringify(resKey)), `${entry}${code}`);
  return dump(dir, page, 6000) as Record<string, unknown>;
};
const report = `const pre = document.createElement("pre"); pre.id = "out"; pre.textContent = JSON.stringify(out); document.body.append(pre);`;

// Focus needs the page itself: a frame inside another page never takes it in headless Chrome.
test("307: Tab to the section's body while a read runs keeps focus there when the read ends", { skip: noBrowser }, () => {
  const got = run(
    {
      400: "window.readMs = 600; btn('refresh').focus(); btn('refresh').click();",
      600: "body().focus(); out.during = active();",
      1500: `out.after = active(); out.reading = !!res().querySelector('.fresh')?.textContent.includes('읽는 중'); ${report}`,
    },
    RES_OPEN_KEY,
  );
  assert.equal(got.during, "res-body");
  assert.equal(got.after, "res-body", "the finished read does not pull focus to 새로 고침");
});

test("307: cancelling the confirm in a view that went stale puts focus on 새로 고침, not on body", { skip: noBrowser }, () => {
  const got = run(
    {
      400: "btn('ask').click();",
      600: `window.skew = ${STALE_MS + 1}; btn('cancel').focus(); btn('cancel').click(); out.after = active(); out.stale = !!res().querySelector('.stale'); ${report}`,
    },
    RES_OPEN_KEY,
  );
  assert.equal(got.stale, true);
  assert.equal(got.after, "refresh");
});

test("307: a 정리 whose reread fails still shows what it did, above the failure line", { skip: noBrowser }, () => {
  const got = run(
    {
      400: "btn('ask').click();",
      600: "window.readsFail = true; btn('run').click();",
      1500: `out.text = body().textContent; ${report}`,
    },
    RES_OPEN_KEY,
  );
  const text = String(got.text);
  assert.match(text, /worktree 1건 정리/);
  assert.match(text, /리소스를 읽지 못했다/);
});
