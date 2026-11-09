import { type GraphPorts, graphRemove } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

const s = (input: Record<string, unknown>, k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
const runs = (input: Record<string, unknown>) => (Array.isArray(input.runs) ? input.runs.map(String) : []);

/** Same Outcome as `sangsoe graph remove`. */
export const handle = (input: Record<string, unknown>, ports: GraphPorts = {}): Promise<Outcome> =>
  graphRemove(ports, { pred: s(input, "pred"), succ: s(input, "succ"), kind: s(input, "kind"), reason: s(input, "reason"), runs: runs(input) });

export default {
  name: "edge_remove",
  description: "Remove an extra dependency edge, with a reason. An Orca dep made at creation cannot be removed here.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["blocks", "after", "stacked_on", "deploys_after"] },
      pred: { type: "string" },
      succ: { type: "string" },
      reason: { type: "string" },
      runs: { type: "array", items: { type: "string" } },
    },
    required: ["kind", "pred", "succ", "reason", "runs"],
    additionalProperties: false,
  },
  handler: (input) => handle(input),
} satisfies ToolDef;
