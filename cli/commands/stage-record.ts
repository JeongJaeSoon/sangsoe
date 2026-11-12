import { agentCheckout, approveExec, type RecordPorts, recorderRefusal, recordStage, SANGSOE_REPO, Store } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const REQUIRED = ["pr", "stage", "sha", "recorder"] as const;
const USAGE = "--pr <N> --stage merge|dev|prod --sha <sha> --recorder <name> [--repo <owner/name>]";
// Word for word the stage_record tool's fix, so both entrances return one Outcome.
const STAGE_FIX = "check --pr (merged), --stage, --sha and --recorder (not the author)";

export async function stageRecord(
  values: CommandArgs["values"],
  deps: RecordPorts = { exec: approveExec, openStore: () => Store.open() },
  checkout: string | null = agentCheckout(),
): Promise<Outcome<string>> {
  const missing = REQUIRED.filter((o) => typeof values[o] !== "string");
  if (missing.length > 0) {
    return { ok: false, refusal: { code: "invalid_input", reason: `missing ${missing.map((o) => `--${o}`).join(", ")}`, fix: `sangsoe stage record ${USAGE}` } };
  }
  const text = (o: string) => String(values[o]);
  const repo = typeof values.repo === "string" ? values.repo : SANGSOE_REPO;
  const pr = /^[0-9]+$/.test(text("pr")) ? Number(text("pr")) : Number.NaN;
  const refused = await recorderRefusal(deps.exec, { tool: "sangsoe stage record", repo, pr, head: null, what: "stages", refused: "stage_refused", fix: STAGE_FIX, noCheckout: "pass" }, checkout);
  if (refused) return refused;
  const r = await recordStage(
    {
      repo,
      pr,
      stage: text("stage"),
      sha: text("sha"),
      recorder: text("recorder"),
    },
    deps,
  );
  return r.ok ? { ok: true, value: r.note } : { ok: false, refusal: { code: "stage_refused", reason: r.note, fix: STAGE_FIX } };
}

export default {
  name: "stage record",
  summary: "record that a merged PR reached a stage (merge, dev, prod) for GRAPH's deploys_after (decision 171)",
  usage: USAGE,
  required: REQUIRED,
  options: { pr: { type: "string" }, stage: { type: "string" }, sha: { type: "string" }, recorder: { type: "string" }, repo: { type: "string" } },
  run: ({ values }) => stageRecord(values),
} satisfies CommandDef;
