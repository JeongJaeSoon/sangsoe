// CI's `unit` job pipes `npm test` into a log and runs this over it (decision 266): the skipped
// tests and the run attempt go to the job summary, so neither a skip nor a rerun stays inside a
// collapsed log.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface TestSummary {
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
  readonly skipped: number;
  readonly todo: number;
  /** The names of the skipped tests, each with its reason when it gave one, in output order. */
  readonly skippedNames: readonly string[];
}

/** Reads `node --test`'s closing counters (the last of each) and its `# SKIP` lines. A missing counter is null: the run did not end. */
export function summarize(output: string): TestSummary | null {
  const last = (name: string): number | undefined => {
    const m = [...output.matchAll(new RegExp(`^ℹ ${name} (\\d+)$`, "gm"))].at(-1);
    return m ? Number(m[1]) : undefined;
  };
  const [tests, pass, fail, skipped, todo] = ["tests", "pass", "fail", "skipped", "todo"].map(last);
  if (tests === undefined || pass === undefined || fail === undefined || skipped === undefined || todo === undefined) return null;
  // A skip with a reason prints `# <reason>` where a bare one prints `# SKIP`.
  const skippedNames = [...output.matchAll(/^\s*﹣ (.+?) \([\d.]+ms\) # (.*)$/gm)].map((m) => (m[2] === "SKIP" ? (m[1] as string) : `${m[1]} (${m[2]})`));
  return { tests, pass, fail, skipped, todo, skippedNames };
}

/**
 * `attempt` is GitHub's attempt number of this workflow run, not of the commit: above 1 means the run
 * was rerun, which GitHub also allows on a green run or after another job failed. So the text says an
 * earlier attempt exists and where to look; it does not say that attempt failed here.
 */
export function render(s: TestSummary, attempt: number): string {
  const lines = [
    "### unit tests",
    "",
    `tests ${s.tests} · pass ${s.pass} · fail ${s.fail} · skipped ${s.skipped} · todo ${s.todo}`,
    "",
    attempt > 1
      ? `**Attempt ${attempt} of this workflow run: it was rerun.** Read the earlier attempt(s): if \`unit\` failed there and passes here, that test is a flake until its cause is found.`
      : "Attempt 1 of this workflow run.",
  ];
  if (s.skippedNames.length > 0) lines.push("", "Skipped:", ...s.skippedNames.map((n) => `- ${n}`));
  // node counts neither a skipped suite nor the tests inside it, but prints the suite's line.
  const unnamed = s.skipped - s.skippedNames.length;
  if (unnamed > 0) lines.push("", `${unnamed} skipped test(s) have no line this script could read; find them in the log.`);
  if (unnamed < 0) lines.push("", `${-unnamed} of the lines above are outside node's skipped count (a skipped suite is listed, and the tests inside it are not counted).`);
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const log = process.argv[2];
  if (!log) {
    console.error("usage: node scripts/ci-test-summary.ts <test output log>");
    process.exit(2);
  }
  // The step also runs when an earlier step failed and npm test never started.
  if (!existsSync(log)) {
    console.error(`${log}: no test output; npm test did not run`);
    process.exit(1);
  }
  const s = summarize(readFileSync(log, "utf8"));
  if (!s) {
    console.error(`${log}: no closing test counters; the skipped count cannot be shown`);
    process.exit(1);
  }
  const text = render(s, Number(process.env.GITHUB_RUN_ATTEMPT ?? "1") || 1);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.stdout.write(text);
}
