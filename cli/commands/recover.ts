import { createOrcaAdapter, nodeExec, type OrcaAdapter, recoverPlan, renderRecover } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome, Report } from "../contract.ts";

export async function recover(values: CommandArgs["values"], orca: OrcaAdapter = createOrcaAdapter(nodeExec())): Promise<Outcome | Report> {
  const run = typeof values.run === "string" && values.run !== "" ? values.run : undefined;
  const limit = typeof values.limit === "string" ? Number(values.limit) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    return { ok: false, refusal: { code: "invalid_input", reason: "--limit must be a positive integer", fix: "sangsoe recover --limit 50" } };
  }
  const plan = await recoverPlan(orca, { ...(run ? { run } : {}), ...(limit ? { limit } : {}) });
  return { code: "error" in plan ? 1 : 0, lines: renderRecover(plan) };
}

export default {
  name: "recover",
  summary: "read-only table of supervised workers after a restart (⚠️: neither live nor settled); writes nothing",
  usage: "[--run <run id>] [--limit <n>]",
  options: { run: { type: "string" }, limit: { type: "string" } },
  run: ({ values }) => recover(values),
} satisfies CommandDef;
