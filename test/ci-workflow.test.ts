import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

test("B4: only ci.yml's npm test step gets the hygiene pattern, as a repository secret; no workflow writes one or hands out every secret", () => {
  const run = (jobs.get("unit") ?? "").split(/\n {6}- /).find((s) => s.includes("npm test"));
  assert.ok(run, "no npm test step");
  const dir = join(ROOT, ".github/workflows");
  const named: string[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(join(dir, file), "utf8");
    assert.doesNotMatch(text, /toJSON\(\s*secrets\s*\)|secrets:\s*inherit/i, `${file} hands out every secret`);
    // A fork's pull request gets no secret only under `pull_request`.
    assert.doesNotMatch(text, /pull_request_target|workflow_run/, `${file} runs a fork's change with secrets`);
    named.push(...text.split("\n").flatMap((l) => (l.includes("SANGSOE_HYGIENE_PATTERN") ? [`${file}|${l}`] : [])));
  }
  assert.equal(named.length, 1, "the variable is named once, on one step of one workflow");
  const [file, line] = (named[0] ?? "|").split("|");
  assert.equal(file, "ci.yml");
  assert.match((line ?? "").trim(), /^SANGSOE_HYGIENE_PATTERN: \$\{\{ secrets\.SANGSOE_HYGIENE_PATTERN \}\}$/, "its value is the secret, not text");
  assert.ok(run.includes(line ?? "\0"), "the secret is passed to a step other than npm test");
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
  "﹣ macOS only (0.19ms) # dash exits 2 on a missing script",
  "ℹ tests 5",
  "ℹ suites 1",
  "ℹ pass 2",
  "ℹ fail 0",
  "ℹ cancelled 0",
  "ℹ skipped 3",
  "ℹ todo 0",
  "ℹ duration_ms 12.5",
].join("\n");

test("B1: the summary counts skipped tests from the closing counters and names them", () => {
  const s = summarize(OUTPUT);
  const names = ["needs real Orca", "needs a browser", "macOS only (dash exits 2 on a missing script)"];
  assert.deepEqual(s, { tests: 5, pass: 2, fail: 0, skipped: 3, todo: 0, skippedNames: names });
  assert.equal(s?.skippedNames.length, s?.skipped, "every counted skip is named");
  const text = render(s as NonNullable<typeof s>, 1);
  assert.match(text, /skipped 3/);
  assert.ok(text.endsWith(`Skipped:\n${names.map((n) => `- ${n}`).join("\n")}\n`), text);
  assert.match(text, /\nAttempt 1 of this workflow run\.\n/);
  assert.doesNotMatch(text, /rerun/);
});

test("B1: a rerun is marked, output without closing counters is no summary, and a count the names do not match is said", () => {
  const s = summarize(OUTPUT) as NonNullable<ReturnType<typeof summarize>>;
  assert.match(render(s, 3), /\*\*Attempt 3 of this workflow run: it was rerun\.\*\*/);
  assert.equal(summarize("✔ a test (0.1ms)\nℹ tests 1\n"), null);
  assert.match(render({ ...s, skipped: 5 }, 1), /\n2 skipped test\(s\) have no line/);
  assert.match(render({ ...s, skipped: 2 }, 1), /\n1 of the lines above are outside node's skipped count/);
  assert.doesNotMatch(render(s, 1), /no line|outside node/);
});
