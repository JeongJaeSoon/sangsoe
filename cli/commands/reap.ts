import { openReaper, openResources, type OwnerReap, type OwnerReaped, type ReaperRunner, type ReapReport, type ResourceView } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const USAGE = "run [--dry-run] [--mark-only] [--db <path>] | run --only <id,...> [--tmp] | run --tmp | plan";

type Resources = { read(): Promise<ResourceView>; reap(a: OwnerReap): Promise<OwnerReaped> };

const ID = /^[A-Za-z0-9._:-]{1,200}$/;

// The shell entrance to the round the plugin worker's timer runs. `--dry-run` writes nothing and
// so never sweeps; `--mark-only` records the round but removes nothing. `plan` and `run --only`
// are the panel's 리소스 read and confirmed 정리 (decision 234): naming the ids is the confirmation.
export async function reap(
  positionals: readonly string[],
  values: CommandArgs["values"],
  open: (o: { dryRun: boolean; dbPath?: string }) => ReaperRunner = openReaper,
  resources: (o: { dbPath?: string }) => Resources = openResources,
): Promise<Outcome<ReapReport | ResourceView | OwnerReaped>> {
  const refuse = (reason: string) => ({ ok: false as const, refusal: { code: "invalid_input", reason, fix: `sangsoe reap ${USAGE}` } });
  if (positionals.length !== 1 || (positionals[0] !== "run" && positionals[0] !== "plan")) return refuse(`expected ${USAGE}`);
  const dbPath = typeof values.db === "string" && values.db !== "" ? values.db : undefined;
  const db = dbPath ? { dbPath } : {};
  if (positionals[0] === "plan") return { ok: true, value: await resources(db).read() };

  const only = typeof values.only === "string" ? values.only.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const tmp = values.tmp === true;
  if (only !== null || tmp) {
    if (values["dry-run"] === true || values["mark-only"] === true) return refuse("--only and --tmp remove what they name; use plan to look first");
    if (only !== null && (only.length === 0 || !only.every((id) => ID.test(id)))) return refuse("--only takes card instance ids from sangsoe reap plan");
    return { ok: true, value: await resources(db).reap({ worktrees: only ?? [], tmp }) };
  }

  const runner = open({ dryRun: values["dry-run"] === true, ...db });
  try {
    // Not "timer": a hand-run round must not hide a stalled worker timer (decision 83).
    return { ok: true, value: await runner.run({ trigger: "hint", markOnly: values["mark-only"] === true }) };
  } finally {
    runner.close();
  }
}

export default {
  name: "reap",
  summary: "run one REAPER round (mark, then sweep what passed every gate); plan lists what 정리 would take; run --only <ids> / --tmp removes only those",
  usage: USAGE,
  maxPositionals: 1,
  options: {
    "dry-run": { type: "boolean" },
    "mark-only": { type: "boolean" },
    db: { type: "string" },
    only: { type: "string" },
    tmp: { type: "boolean" },
  },
  run: ({ positionals, values }) => reap(positionals, values),
} satisfies CommandDef;
