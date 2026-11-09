import { type GraphPorts, graphRemove, runList } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** Same core call as the MCP tool edge_remove. */
export const graphRemoveCommand = (values: CommandArgs["values"], ports: GraphPorts = {}): Promise<Outcome> =>
  graphRemove(ports, { pred: s(values.pred), succ: s(values.succ), kind: s(values.kind), reason: s(values.reason), runs: runList(values.run) });

export default {
  name: "graph remove",
  summary: "remove an extra edge, with a reason; an Orca dep made at creation is refused",
  usage: "--pred <ref> --succ <iNNN> --kind <kind> --reason <text> --run <run id> [--run ...]",
  options: {
    pred: { type: "string" },
    succ: { type: "string" },
    kind: { type: "string" },
    reason: { type: "string" },
    run: { type: "string", multiple: true },
  },
  required: ["pred", "succ", "kind", "reason", "run"],
  run: ({ values }) => graphRemoveCommand(values),
} satisfies CommandDef;
