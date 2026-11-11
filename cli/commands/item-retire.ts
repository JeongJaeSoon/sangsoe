import { type GraphPorts, retireItem, withGraphPorts } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** Same core call as the MCP tool item_retire. */
export const itemRetireCommand = (values: CommandArgs["values"], positionals: readonly string[], ports: GraphPorts = {}): Promise<Outcome> =>
  withGraphPorts(ports, (deps) =>
    retireItem(deps, { item: positionals[0] ?? "", reason: s(values.reason), by: s(values.by), ...(s(values.run) ? { run: s(values.run) } : {}) }),
  );

export default {
  name: "item retire",
  summary: "retire a completed item whose PR closed without a merge, with who and why; it then reads 🗑️ and leaves the blocked counts (decision 223)",
  usage: "<iNNN> --reason <text> --by <owner|lead:<name>> [--run <run id>]",
  options: {
    reason: { type: "string" },
    by: { type: "string" },
    run: { type: "string" },
  },
  required: ["reason", "by"],
  maxPositionals: 1,
  run: ({ values, positionals }) => itemRetireCommand(values, positionals),
} satisfies CommandDef;
