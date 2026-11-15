// CI's `unit` job pipes `npm test` into a log and runs this over it (decision 266): the skipped
// tests and the run attempt go to the job summary, so neither a skip nor a rerun that turned a
// red run green stays inside a collapsed log.
import { appendFileSync, readFileSync } from "node:fs";
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

/** `attempt` is GitHub's run attempt: above 1 means a person reran this commit's job after a failure. */
export function render(s: TestSummary, attempt: number): string {
  const lines = [
    "### unit tests",
    "",
    `tests ${s.tests} · pass ${s.pass} · fail ${s.fail} · skipped ${s.skipped} · todo ${s.todo}`,
    "",
    attempt > 1 ? `**Rerun: attempt ${attempt}.** ${attempt - 1} earlier attempt(s) of this commit did not pass; a green here is a flake until the cause is found.` : "Rerun: attempt 1 (no earlier attempt of this commit).",
  ];
  if (s.skippedNames.length > 0) lines.push("", "Skipped:", ...s.skippedNames.map((n) => `- ${n}`));
  const unnamed = s.skipped - s.skippedNames.length;
  if (unnamed > 0) lines.push("", `${unnamed} skipped test(s) have no line this script could read; find them in the log.`);
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const log = process.argv[2];
  if (!log) {
    console.error("usage: node scripts/ci-test-summary.ts <test output log>");
    process.exit(2);
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
