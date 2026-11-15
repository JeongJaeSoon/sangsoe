import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { render, summarize } from "../scripts/ci-test-summary.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const yml = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
// Each job is a two-space key under `jobs:`; its body runs to the next one.
const jobsText = yml.split(/^jobs:\n/m)[1] ?? "";
const heads = [...jobsText.matchAll(/^ {2}([\w-]+):\n/gm)];
const jobs = new Map(heads.map((m, i) => [m[1] as string, jobsText.slice(m.index, heads[i + 1]?.index)] as const));

test("B1: the three CI jobs are separate (parallel) and each has a time limit of at most 30 minutes", () => {
  assert.deepEqual([...jobs.keys()], ["typecheck", "lint", "unit"]);
  for (const [name, body] of jobs) {
    assert.doesNotMatch(body, /^ {4}needs:/m, `${name} waits on another job`);
    const m = body.match(/^ {4}timeout-minutes: (\d+)$/m);
    assert.ok(m, `${name} has no timeout-minutes`);
    assert.ok(Number(m[1]) <= 30, `${name}: ${m[1]} minutes`);
  }
});

test("B1: the unit job logs npm test under pipefail and summarizes it even when a test failed", () => {
  const unit = jobs.get("unit") ?? "";
  const steps = unit.split(/\n {6}- /);
  const run = steps.find((s) => s.includes("npm test"));
  assert.ok(run, "no npm test step");
  assert.ok(run.includes("shell: bash"), "npm test piped without `shell: bash` loses its exit code (no pipefail)");
  assert.match(run, /npm test 2>&1 \| tee "\$RUNNER_TEMP\/test-output\.log"/);
  const summary = steps.find((s) => s.includes("scripts/ci-test-summary.ts"));
  assert.ok(summary, "no summary step");
  assert.match(summary, /if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(summary, /"\$RUNNER_TEMP\/test-output\.log"/);
});

const OUTPUT = [
  "✔ a test (0.1ms)",
  "▶ a suite",
  "  ﹣ needs real Orca (0.27ms) # SKIP",
  "  ✔ runs (1ms)",
  "✔ a suite (2ms)",
  // A child run a test printed: its counters come first and must not win.
  "ℹ skipped 9",
  "﹣ needs a browser (0.04ms) # SKIP",
  "ℹ tests 4",
  "ℹ suites 1",
  "ℹ pass 2",
  "ℹ fail 0",
  "ℹ cancelled 0",
  "ℹ skipped 2",
  "ℹ todo 0",
  "ℹ duration_ms 12.5",
].join("\n");

test("B1: the summary counts skipped tests from the closing counters and names them", () => {
  const s = summarize(OUTPUT);
  assert.deepEqual(s, { tests: 4, pass: 2, fail: 0, skipped: 2, todo: 0, skippedNames: ["needs real Orca", "needs a browser"] });
  const text = render(s as NonNullable<typeof s>, 1);
  assert.match(text, /skipped 2/);
  assert.match(text, /- needs real Orca\n- needs a browser\n/);
  assert.match(text, /Rerun: attempt 1 /);
});

test("B1: a rerun attempt is called a flake, and output without closing counters is no summary", () => {
  const s = summarize(OUTPUT);
  assert.match(render(s as NonNullable<typeof s>, 3), /\*\*Rerun: attempt 3\.\*\* 2 earlier attempt\(s\)/);
  assert.equal(summarize("✔ a test (0.1ms)\nℹ tests 1\n"), null);
});
