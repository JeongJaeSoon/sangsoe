import { type GraphPorts, impact, readInput, runList, withGraphPorts } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Report } from "../contract.ts";

export const graphImpactCommand = (values: CommandArgs["values"], positionals: readonly string[], ports: GraphPorts = {}): Promise<Report> =>
  withGraphPorts(ports, async (deps) => {
    const item = positionals[0];
    if (!item) return { code: 2, lines: ["usage: sangsoe graph impact <iNNN|task id> --run <run id>"] };
    const input = await readInput(deps, runList(values.run), ports.now?.() ?? new Date().toISOString());
    if (!input.ok) return { code: 1, lines: [`${input.refusal.reason} [${input.refusal.code}]`, `fix: ${input.refusal.fix}`] };
    const rows = impact(input.value, item);
    if (rows.length === 0) return { code: 0, lines: [`${item} 뒤에 밀리는 항목 없음`] };
    return { code: 0, lines: rows.map((r) => `${r.distance}  ${r.item}  ${r.priority}  ${r.lead ?? "(리드 없음)"}`) };
  });

export default {
  name: "graph impact",
  summary: "what slips if this item slips: unfinished successors, nearest first",
  usage: "<iNNN|task id> --run <run id> [--run ...]",
  options: { run: { type: "string", multiple: true } },
  required: ["run"],
  maxPositionals: 1,
  run: ({ values, positionals }) => graphImpactCommand(values, positionals),
} satisfies CommandDef;
