import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { tableRows, ticks } from "./tables.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const md = readFileSync(join(ROOT, "docs/requirements-coverage.md"), "utf8");
const rows = tableRows(md);
const rRows = rows.filter((r) => /^R-\d\d$/.test(r[0] ?? ""));
const dRows = rows.filter((r) => /^D-\d+$/.test(r[0] ?? ""));

const status = (cell: string) =>
  cell.startsWith("🟢") ? "green" : cell.startsWith("🟡") ? "partial" : cell.startsWith("🔴") ? "red" : /^(PR #\d+|U\d+)/.test(cell) ? "unit" : "?";

test("R-01–R-23 each have one row, in order", () => {
  assert.deepEqual(
    rRows.map((r) => r[0]),
    Array.from({ length: 23 }, (_, i) => `R-${String(i + 1).padStart(2, "0")}`),
  );
});

test("a green or partial R row names test files that exist; a red or unit row names none", () => {
  for (const [id, , tests, state] of rRows) {
    const s = status(state ?? "");
    assert.notEqual(s, "?", `${id}: status ${state}`);
    const files = ticks(tests ?? "");
    if (s === "green" || s === "partial") {
      assert.ok(files.length > 0, `${id}: ${s} needs a test file`);
      for (const f of files) {
        assert.match(f, /\.test\.ts$/, `${id}: ${f} is not a test file`);
        assert.ok(existsSync(join(ROOT, f)), `${id}: ${f} does not exist`);
      }
    } else assert.equal(tests, "—", `${id}: a ${s} row has no test file`);
    if (s === "partial" || s === "red") assert.ok((state ?? "").length > 2, `${id}: say what is missing`);
  }
});

test("D-1–D-13 each have a row whose paths exist", () => {
  assert.deepEqual(
    dRows.map((r) => r[0]),
    Array.from({ length: 13 }, (_, i) => `D-${i + 1}`),
  );
  for (const [id, , where] of dRows) for (const p of ticks(where ?? "")) assert.ok(existsSync(join(ROOT, p)), `${id}: ${p} does not exist`);
});

test("the summary line counts the R rows as they are", () => {
  const n = (s: string) => rRows.filter((r) => status(r[3] ?? "") === s).length;
  const line = `집계: R ${rRows.length}행 · 🟢 ${n("green")} · 🟡 ${n("partial")} · 🔴 ${n("red")} · 단위 ${n("unit")}`;
  assert.ok(md.includes(line), `docs/requirements-coverage.md should say: ${line}`);
});
