import { type GraphPorts, graphSkip } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** Same core call as the MCP tool flow_step_skip. */
export const graphSkipCommand = (values: CommandArgs["values"], ports: GraphPorts = {}): Promise<Outcome> =>
  graphSkip(ports, { root: s(values.root), step: s(values.step), reason: s(values.reason) });

export default {
  name: "graph skip",
  summary: "skip one step of an expanded flow, with a reason; an empty reason is refused",
  usage: "--root <iNNN> --step <step id> --reason <text>",
  options: {
    root: { type: "string" },
    step: { type: "string" },
    reason: { type: "string" },
  },
  required: ["root", "step", "reason"],
  run: ({ values }) => graphSkipCommand(values),
} satisfies CommandDef;
