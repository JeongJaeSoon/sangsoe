import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { tableRows, ticks } from "./tables.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const entries = read("test/fixtures/migrate/agent-skills-entries.txt")
  .split("\n")
  .filter((l) => l.trim() !== "" && !l.startsWith("#"));
const md = read("docs/port-map.md");
const rows = tableRows(md);

test("every agent-skills top-level entry has a row in docs/port-map.md", () => {
  assert.ok(entries.length >= 160,`the checked-in list looks cut short: ${entries.length}`);
  const named = new Set(rows.flatMap((r) => ticks(r[0] ?? "")));
  const missing = entries.filter((e) => !named.has(e));
  assert.deepEqual(missing, []);
});

test("each row is a path that exists, a pending PR or unit, DROP or GAP, with a reason", () => {
  for (const [old, where, why] of rows) {
    const label = `${old} → ${where}`;
    assert.equal(rows.find((r) => r.length !== 3), undefined, "every row has three cells");
    assert.ok(why && why.length > 0, `${label}: the third cell is empty`);
    const paths = ticks(where ?? "");
    for (const p of paths) assert.ok(existsSync(join(ROOT, p)), `${label}: ${p} does not exist in this repository`);
    const kinds = { path: paths.length > 0, pr: /PR #\d+/.test(where ?? ""), unit: /\bU\d+\b/.test(where ?? ""), drop: where === "DROP", gap: /\bGAP\b/.test(where ?? "") };
    assert.ok(Object.values(kinds).some(Boolean), `${label}: the location is neither a path, PR #N, U<n>, DROP nor GAP`);
    if ((where ?? "").includes("DROP")) assert.equal(where, "DROP", `${label}: DROP stands alone, its reason goes in the third cell`);
  }
});

test("the summary line counts the rows as they are", () => {
  const n = (re: RegExp) => rows.filter((r) => re.test(r[1] ?? "")).length;
  const counts = {
    rows: rows.length,
    path: rows.filter((r) => ticks(r[1] ?? "").length > 0).length,
    pr: n(/PR #\d+/),
    unit: n(/\bU\d+\b/),
    drop: n(/^DROP$/),
    gap: n(/\bGAP\b/),
  };
  const line = `집계: 행 ${counts.rows} · 경로 ${counts.path} · PR ${counts.pr} · 단위 ${counts.unit} · DROP ${counts.drop} · GAP ${counts.gap}`;
  assert.ok(md.includes(line), `docs/port-map.md should say: ${line}`);
});
