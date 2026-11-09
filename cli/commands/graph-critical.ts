import { criticalPath, type GraphPorts, readInput, runList, withGraphPorts } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Report } from "../contract.ts";

export const graphCriticalCommand = (values: CommandArgs["values"], ports: GraphPorts = {}): Promise<Report> =>
  withGraphPorts(ports, async (deps) => {
    const input = await readInput(deps, runList(values.run), ports.now?.() ?? new Date().toISOString());
    if (!input.ok) return { code: 1, lines: [`${input.refusal.reason} [${input.refusal.code}]`, `fix: ${input.refusal.fix}`] };
    const c = criticalPath(input.value, typeof values.lead === "string" ? values.lead : undefined);
    if (c.path.length === 0) return { code: 0, lines: ["끝나지 않은 항목 없음"] };
    const unit = c.estimated ? "추정" : "단계";
    return {
      code: 0,
      lines: [
        `크리티컬 패스 ${c.length} (${unit}) · 지금 늦추는 것: ${c.slowest?.item}`,
        c.path.map((n) => (n.externalGroup ? `${n.item}[외부 선행: ${n.externalGroup}]` : n.item)).join(" → "),
      ],
    };
  });

export default {
  name: "graph critical",
  summary: "the longest chain of unfinished items (est if given, else steps, marked 추정)",
  usage: "--run <run id> [--run ...] [--lead <lead>]",
  options: { run: { type: "string", multiple: true }, lead: { type: "string" } },
  required: ["run"],
  run: ({ values }) => graphCriticalCommand(values),
} satisfies CommandDef;
