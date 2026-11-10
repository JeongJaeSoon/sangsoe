import assert from "node:assert/strict";
import { test } from "node:test";
// Namespace imports: a missing export reads as undefined and fails an assertion, not the module link.
import * as views from "../../core/index.ts";
import * as panel from "../../orca-plugin/panel/view.ts";

test("every ItemReading has a label that is not its raw key (a new reading without one fails here)", () => {
  const readings: readonly string[] = views.ITEM_READINGS ?? [];
  const labels: Readonly<Record<string, string>> = views.READING_LABEL ?? {};
  assert.ok(readings.includes("pending_verify") && readings.includes("pr_closed") && readings.includes("unknown"), "ITEM_READINGS lists the readings no transition writes");
  for (const r of readings) {
    const label = labels[r];
    assert.ok(label, `${r} has no label`);
    assert.ok(!label.includes(r), `${r}'s label shows the raw key: ${label}`);
  }
  assert.equal(labels.pending_verify, "⏳ 검증 대기", "the hourglass label the brief uses (decision 181)");
});

test("the panel's note after a 완료 press shows the label, not the status key", () => {
  const note = panel.actedNote?.({ kind: "done", item: "i012" }, { status: "pending_verify", label: "⏳ 검증 대기" });
  assert.equal(note, "i012: ⏳ 검증 대기");
  assert.equal(panel.actedNote?.({ kind: "answer", decision: "d001", choice: "recommended" }, { status: "answered", label: "답이 달려 닫힘" }), "d001: 답이 달려 닫힘");
});
