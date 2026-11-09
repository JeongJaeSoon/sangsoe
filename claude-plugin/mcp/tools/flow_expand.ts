import { type GraphPorts, graphExpand } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

const s = (input: Record<string, unknown>, k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");

/** Same Outcome as `sangsoe graph expand`. */
export const handle = (input: Record<string, unknown>, ports: GraphPorts & { flowDirs?: readonly string[] } = {}): Promise<Outcome> => {
  const vars = typeof input.vars === "object" && input.vars !== null ? Object.fromEntries(Object.entries(input.vars).map(([k, v]) => [k, String(v)])) : {};
  return graphExpand(ports, {
    template: s(input, "template"),
    vars,
    run: s(input, "run"),
    who: s(input, "who"),
    requestId: s(input, "request_id"),
    dryRun: input.dry_run === true,
    ...(ports.flowDirs ? { flowDirs: ports.flowDirs } : {}),
  });
};

export default {
  name: "flow_expand",
  description: "Expand a flow template (e.g. ship-change, ship-batch) into Orca Tasks and edges. dry_run returns the plan and writes nothing; the same request_id resumes.",
  inputSchema: {
    type: "object",
    properties: {
      template: { type: "string" },
      vars: { type: "object", description: "Template vars as strings, e.g. {\"repo\": \"acme/api\"}." },
      run: { type: "string" },
      who: { type: "string", description: "Owner of the flow's items, e.g. lead:api." },
      request_id: { type: "string" },
      dry_run: { type: "boolean" },
    },
    required: ["template"],
    additionalProperties: false,
  },
  handler: (input) => handle(input),
} satisfies ToolDef;
