import { type GraphPorts, readInput, renderWhy, runList, why, withGraphPorts } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Report } from "../contract.ts";

/** Decision 92④'s table: 항목 · 막는 선행 · 간선 종류 · 선행 상태 · 해야 할 일, one row per blocking predecessor. */
export const graphWhyCommand = (values: CommandArgs["values"], positionals: readonly string[], ports: GraphPorts = {}): Promise<Report> =>
  withGraphPorts(ports, async (deps) => {
    const item = positionals[0];
    if (!item) return { code: 2, lines: ["usage: sangsoe graph why <iNNN|task id> --run <run id>"] };
    const input = await readInput(deps, runList(values.run), ports.now?.() ?? new Date().toISOString());
    if (!input.ok) return { code: 1, lines: [`${input.refusal.reason} [${input.refusal.code}]`, `fix: ${input.refusal.fix}`] };
    return { code: 0, lines: renderWhy(why(input.value, item)).split("\n") };
  });

export default {
  name: "graph why",
  summary: "why an item is or is not ready: blocking predecessor, edge kind, its state, what to do",
  usage: "<iNNN|task id> --run <run id> [--run ...]",
  options: { run: { type: "string", multiple: true } },
  required: ["run"],
  maxPositionals: 1,
  run: ({ values, positionals }) => graphWhyCommand(values, positionals),
} satisfies CommandDef;
