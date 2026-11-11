import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The smoke run itself drives real Orca and GitHub and is not repeatable in CI; what CI holds is
// the record's shape: ten items, each with exactly one verdict, and a reason on every NOT VERIFIED.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const md = readFileSync(join(ROOT, "docs/smoke-run.md"), "utf8");

const sections = md.split(/^## /m).slice(1);
const items = sections.filter((s) => /^\d+\. /.test(s));

test("docs/smoke-run.md has items 1–10 in order", () => {
  assert.deepEqual(
    items.map((s) => Number(s.slice(0, s.indexOf(".")))),
    Array.from({ length: 10 }, (_, i) => i + 1),
  );
});

test("each item carries one verdict, and NOT VERIFIED says why", () => {
  for (const s of items) {
    const n = s.slice(0, s.indexOf("."));
    const verdicts = [...s.matchAll(/^판정: (PASS|FAIL|NOT VERIFIED)(.*)$/gm)];
    assert.equal(verdicts.length, 1, `item ${n}: expected one 판정 line, found ${verdicts.length}`);
    const [, value, rest] = verdicts[0] as RegExpMatchArray;
    if (value === "NOT VERIFIED") assert.match(rest ?? "", /\(.+\)/, `item ${n}: NOT VERIFIED needs a reason in parentheses`);
  }
});

test("the record quotes no home directory", () => {
  assert.doesNotMatch(md, /\/Users\/[^/\s]+/);
});
