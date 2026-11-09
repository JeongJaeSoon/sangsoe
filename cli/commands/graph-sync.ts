import { type GraphPorts, readInput, runList, syncGraph, withGraphPorts } from "../../core/index.ts";
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
    return { ok: true, value: syncGraph(deps, input.value.orca, stacks(values.stack)) };
  });

export default {
  name: "graph sync",
  summary: "turn detector signals (pr_opened, pr_base_changed, pr_closed, pr_merged) into edges; queue-monitor calls it",
  usage: "--run <run id> [--run ...] [--stack <pr>=<base pr> ...]",
  options: { run: { type: "string", multiple: true }, stack: { type: "string", multiple: true } },
  required: ["run"],
  run: ({ values }) => graphSyncCommand(values),
} satisfies CommandDef;
