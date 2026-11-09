import { openReaper, type ReaperRunner, type ReapReport } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const USAGE = "run [--dry-run] [--mark-only] [--db <path>]";

// The shell entrance to the round the plugin worker's timer runs. `--dry-run` writes nothing and
// so never sweeps; `--mark-only` records the round but removes nothing.
export async function reap(
  positionals: readonly string[],
  values: CommandArgs["values"],
  open: (o: { dryRun: boolean; dbPath?: string }) => ReaperRunner = openReaper,
): Promise<Outcome<ReapReport>> {
  if (positionals[0] !== "run" || positionals.length !== 1) {
    return { ok: false, refusal: { code: "invalid_input", reason: `expected ${USAGE}`, fix: `sangsoe reap ${USAGE}` } };
  }
  const dbPath = typeof values.db === "string" && values.db !== "" ? values.db : undefined;
  const runner = open({ dryRun: values["dry-run"] === true, ...(dbPath ? { dbPath } : {}) });
  try {
    // Not "timer": a hand-run round must not hide a stalled worker timer (decision 83).
    return { ok: true, value: await runner.run({ trigger: "hint", markOnly: values["mark-only"] === true }) };
  } finally {
    runner.close();
  }
}

export default {
  name: "reap",
  summary: "run one REAPER round (mark, then sweep what passed every gate); --dry-run or --mark-only removes nothing",
  usage: USAGE,
  maxPositionals: 1,
  options: { "dry-run": { type: "boolean" }, "mark-only": { type: "boolean" }, db: { type: "string" } },
  run: ({ positionals, values }) => reap(positionals, values),
} satisfies CommandDef;
