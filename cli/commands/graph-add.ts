import { type GraphPorts, graphAdd, runList } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** Same core call as the MCP tool edge_add. */
export const graphAddCommand = (values: CommandArgs["values"], ports: GraphPorts = {}): Promise<Outcome> =>
  graphAdd(ports, { pred: s(values.pred), succ: s(values.succ), kind: s(values.kind), runs: runList(values.run) });

export default {
  name: "graph add",
  summary: "add an edge (blocks, after, stacked_on, deploys_after); refuses a cycle, an unknown item, a non-item successor",
  usage: "--pred <iNNN|owner/repo#N|dNNN> --succ <iNNN> --kind <kind> --run <run id> [--run ...]",
  options: { pred: { type: "string" }, succ: { type: "string" }, kind: { type: "string" }, run: { type: "string", multiple: true } },
  required: ["pred", "succ", "kind", "run"],
  run: ({ values }) => graphAddCommand(values),
} satisfies CommandDef;
