import { type GraphPorts, graphExpand } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** `--var k=v` pairs; a malformed one makes the call fail on an empty var name. */
function vars(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of Array.isArray(v) ? v : v === undefined ? [] : [v]) {
    const [k = "", ...rest] = String(pair).split("=");
    out[k] = rest.join("=");
  }
  return out;
}

/** Same core call as the MCP tool flow_expand. */
export const graphExpandCommand = (values: CommandArgs["values"], ports: GraphPorts & { flowDirs?: readonly string[] } = {}): Promise<Outcome> =>
  graphExpand(ports, {
    template: s(values.template),
    vars: vars(values.var),
    run: s(values.run),
    who: s(values.who),
    requestId: s(values["request-id"]),
    dryRun: values["dry-run"] === true,
    ...(ports.flowDirs ? { flowDirs: ports.flowDirs } : {}),
  });

export default {
  name: "graph expand",
  summary: "expand a flow template into Orca Tasks and edges (--dry-run shows them and writes nothing)",
  usage: "--template <name> [--var k=v ...] [--dry-run] | --run <run id> --who <owner> --request-id <id>",
  options: {
    template: { type: "string" },
    var: { type: "string", multiple: true },
    run: { type: "string" },
    who: { type: "string" },
    "request-id": { type: "string" },
    "dry-run": { type: "boolean" },
  },
  required: ["template"],
  run: ({ values }) => graphExpandCommand(values),
} satisfies CommandDef;
