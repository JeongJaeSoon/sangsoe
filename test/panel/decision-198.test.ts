// Decision 198 on the panel: one reading for band and status bar, local time, Korean errors that keep
// the way back, and a pressed ⏳ 검증 대기 row whose 완료 stays off. Pinned to a zone that is not UTC.
process.env.TZ = "Asia/Tokyo";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type BriefInput, type BriefSnapshot, buildBrief, localShort, localStamp, panelView, renderMarkdown, replayJsonl, statusBarItem } from "../../core/index.ts";
import { autoRefresh, ERROR_LINE, errorLine, openTarget, type PanelView, prunePending, renderError, renderStage } from "../../orca-plugin/panel/view.ts";

const FIX = new URL("../fixtures/brief/", import.meta.url);
const NOW = "2026-11-10T12:00:00.000Z";
const input: BriefInput = {
  events: replayJsonl(readFileSync(new URL("sample.events.jsonl", FIX), "utf8")),
  orca: JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot,
  now: NOW,
};
const view = (target: { group?: string; item?: string }) => {
  const r = panelView(input, target);
  assert.ok(r.ok, JSON.stringify(r));
  return r.value;
};

test("one UTC instant is drawn in the system zone everywhere a person reads it; storage stays UTC", () => {
  assert.equal(localStamp(NOW), "2026-11-10 21:00");
  assert.equal(localShort(NOW), "11-10 21:00");
  assert.equal(localStamp("not a time"), "not a time");

  const v = view({});
  assert.deepEqual(v.fresh, { short: "11-10 21:00", full: "갱신 2026-11-10 21:00 (GMT+9)" });
  const head = /<header class="top">.*?<\/header>/s.exec(renderStage(v as unknown as PanelView))?.[0] ?? "";
  assert.match(head, /<span class="fresh" title="갱신 2026-11-10 21:00 \(GMT\+9\)">11-10 21:00<\/span>/);
  assert.doesNotMatch(head, /12:00/, "no UTC time in the header or its tooltip");

  assert.match(renderMarkdown(buildBrief(input)), /^현황 · 2026-11-10 21:00 · /);

  const item = input.events.find((e) => e.type === "item_created");
  assert.ok(item);
  const three = view({ item: String(item.payload.alias) });
  if (three.model.stage !== 3) throw new Error("stage");
  const first = three.model.chain.rows.find((r) => r.id === `seq:${item.seq}`)?.cells[0]?.text ?? "";
  assert.equal(first, localShort(item.ts), "the chain's item_created time, local");
  assert.notEqual(first, `${item.ts.slice(5, 10)} ${item.ts.slice(11, 16)}`, "not the UTC slice");
  assert.ok(input.events.every((e) => e.ts.endsWith("Z")), "the events keep UTC");
});

test("the band and status bar B come from one reading: the view carries the status bar's own item", () => {
  for (const target of [{}, { group: "api-migration" }]) {
    const v = view(target);
    assert.deepEqual(v.status, statusBarItem(buildBrief(input)));
  }
  const one = view({});
  if (one.model.stage !== 1) throw new Error("stage");
  assert.ok(one.status.text.includes(`결정 ${one.model.todo.decisions}`));
});

test("the panel re-reads by itself only while shown, after a good reading, with nothing in flight or typed", () => {
  const base = { visible: true, lastOk: true, busy: false, formOpen: false };
  assert.equal(autoRefresh(base), true);
  assert.equal(autoRefresh({ ...base, visible: false }), false);
  assert.equal(autoRefresh({ ...base, lastOk: false }), false, "a failed reading waits for 새로 고침: no refresh loop");
  assert.equal(autoRefresh({ ...base, busy: true }), false);
  assert.equal(autoRefresh({ ...base, formOpen: true }), false, "a redraw would wipe the typed answer");
});

test("a refusal is one short Korean line with the raw text in its title; the header and back line stay", () => {
  for (const [code, line] of Object.entries(ERROR_LINE)) {
    assert.match(line, /[가-힣]/, code);
    assert.ok(line.length <= 60, `${code}: one short line`);
  }
  const raw = { code: "selector_not_found", reason: '{"selector":"active"}', fix: "run sangsoe brief in a terminal" };
  assert.equal(errorLine(raw), "sangsoe 가 요청을 처리하지 못했다.", "an unlisted code is the generic line, never the raw text");

  const nf = { code: "not_found", reason: "no open group api-migration", fix: "go back to 현황" };
  const html = renderError(nf, ["현황", "api-migration"], { group: "api-migration" });
  assert.match(html, /^<div class="bar"><header class="top">/, "the header row stays");
  assert.match(html, /data-back/, "the way back stays");
  assert.match(html, /data-refresh/);
  const text = html.replace(/<[^>]+>/g, " ");
  assert.ok(text.includes(ERROR_LINE.not_found ?? ""));
  assert.ok(!text.includes("no open group"), "the English reason is not in the text");
  assert.match(html, /title="not_found · no open group api-migration · go back to 현황"/);
  assert.doesNotMatch(renderError({ code: "core_unavailable", reason: "core not found", fix: "run sangsoe doctor" }), /data-back/, "현황 has no way back to draw");
});

test("an owner item the panel pressed into ⏳ 검증 대기 keeps its 완료 off", () => {
  const v = view({}) as unknown as PanelView;
  const owner = v.todo.find((r) => r.kind === "owner_item");
  assert.ok(owner, "the fixture has an owner item");
  const done = `data-act="${JSON.stringify({ kind: "done", item: owner.ref }).replace(/"/g, "&quot;")}"`;
  assert.ok(renderStage(v).includes(done));
  const pressed = renderStage(v, "all", {}, new Set([owner.ref]));
  assert.ok(!pressed.includes(done), "no 완료 act on the pressed row");
  assert.match(pressed, /<button type="button" class="btn" disabled><span class="em">⏳<\/span>검증 대기<\/button>/);

  const pending = new Set([owner.ref, "i999"]);
  prunePending(pending, v.todo);
  assert.deepEqual([...pending], [owner.ref], "a pressed item the reading no longer lists leaves the set");
});

test("an item opened straight from 현황 still names itself to the terminal button", () => {
  assert.deepEqual(openTarget([]), {});
  assert.deepEqual(openTarget([{ item: "i026" }]), { item: "i026" });
  assert.deepEqual(openTarget([{ group: "acme" }, { item: "i026" }]), { group: "acme", item: "i026" });
  assert.ok(renderStage(view({ item: "i026" }) as unknown as PanelView, "all", openTarget([{ item: "i026" }])).includes("&quot;item&quot;:&quot;i026&quot;"));
});
