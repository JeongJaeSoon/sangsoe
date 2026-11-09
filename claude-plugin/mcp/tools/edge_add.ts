import { type GraphPorts, graphAdd } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

const s = (input: Record<string, unknown>, k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
const runs = (input: Record<string, unknown>) => (Array.isArray(input.runs) ? input.runs.map(String) : []);

/** Same Outcome as `sangsoe graph add`. */
export const handle = (input: Record<string, unknown>, ports: GraphPorts = {}): Promise<Outcome> =>
  graphAdd(ports, { pred: s(input, "pred"), succ: s(input, "succ"), kind: s(input, "kind"), runs: runs(input) });

export default {
  name: "edge_add",
  description: "Add a dependency edge after creation (blocks, after, stacked_on, deploys_after). Refuses a cycle, an unknown item and a non-item successor.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["blocks", "after", "stacked_on", "deploys_after"] },
      pred: { type: "string", description: "iNNN, item:<task id>, owner/repo#N or dNNN." },
      succ: { type: "string", description: "The waiting item: iNNN or item:<task id>." },
      runs: { type: "array", items: { type: "string" }, description: "Run ids whose Tasks the edge touches." },
    },
    required: ["kind", "pred", "succ", "runs"],
    additionalProperties: false,
  },
  handler: (input) => handle(input),
} satisfies ToolDef;
