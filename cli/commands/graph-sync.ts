import { type GraphPorts, readInput, rereviewItems, runList, syncGraph, withGraphPorts } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

/** `--stack <owner/repo#N>=<owner/repo#M>`: the first PR sits on the second (read from GitHub by the caller). */
function stacks(v: unknown): { pr: string; base: string }[] {
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => {
    const [pr = "", base = ""] = String(x).split("=");
    return { pr, base };
  });
}

export const graphSyncCommand = (values: CommandArgs["values"], ports: GraphPorts = {}): Promise<Outcome> =>
  withGraphPorts(ports, async (deps) => {
    const input = await readInput(deps, runList(values.run), ports.now?.() ?? new Date().toISOString());
    if (!input.ok) return input;
    const bad = stacks(values.stack).find((x) => !x.pr || !x.base);
    if (bad) return { ok: false, refusal: { code: "invalid_input", reason: "--stack takes <pr>=<base pr>", fix: "e.g. --stack acme/api#2=acme/api#1" } };
    const synced = syncGraph(deps, input.value.orca, stacks(values.stack));
    // Decision 217: run from the Run's own session, this makes the re-review items Orca fenced the timer out of.
    const rereview = await rereviewItems(deps, input.value.orca);
    return { ok: true, value: { ...synced, rereview } };
  });

export default {
  name: "graph sync",
  summary: "turn detector signals (pr_opened, pr_base_changed, pr_closed, pr_merged) into edges and make missing re-review items; queue-monitor calls it, and a lead runs it when woken with rereview_item",
  usage: "--run <run id> [--run ...] [--stack <pr>=<base pr> ...]",
  options: { run: { type: "string", multiple: true }, stack: { type: "string", multiple: true } },
  required: ["run"],
  run: ({ values }) => graphSyncCommand(values),
} satisfies CommandDef;
