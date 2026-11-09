import { type GraphPorts, readInput, readiness, runList, withGraphPorts } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Report } from "../contract.ts";

/** One line per 🟢 item; an owner-started one says so (it goes to owner_todo, not a lead's start list). */
export const graphReadyCommand = (values: CommandArgs["values"], ports: GraphPorts = {}): Promise<Report> =>
  withGraphPorts(ports, async (deps) => {
    const input = await readInput(deps, runList(values.run), ports.now?.() ?? new Date().toISOString());
    if (!input.ok) return { code: 1, lines: [`${input.refusal.reason} [${input.refusal.code}]`, `fix: ${input.refusal.fix}`] };
    const rows = readiness(input.value).filter((r) => r.readiness === "ready" || r.readiness === "owner_ready");
    if (rows.length === 0) return { code: 0, lines: ["준비된 항목 없음"] };
    return { code: 0, lines: rows.map((r) => `🟢 ${r.item}  ${r.task}${r.readiness === "owner_ready" ? "  (오너가 시작)" : ""}`) };
  });

export default {
  name: "graph ready",
  summary: "items whose Orca deps, extra edges and trigger are all met (computed, not stored)",
  usage: "--run <run id> [--run ...]",
  options: { run: { type: "string", multiple: true } },
  required: ["run"],
  run: ({ values }) => graphReadyCommand(values),
} satisfies CommandDef;
