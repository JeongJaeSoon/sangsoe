import { type GraphPorts, graphSkip } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

const s = (input: Record<string, unknown>, k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");

/** Same Outcome as `sangsoe graph skip`. */
export const handle = (input: Record<string, unknown>, ports: GraphPorts = {}): Promise<Outcome> =>
  graphSkip(ports, { root: s(input, "root"), step: s(input, "step"), reason: s(input, "reason") });

export default {
  name: "flow_step_skip",
  description: "Skip one step of an expanded flow, with a reason, so flow_gap no longer holds the root item's done. An empty reason is refused.",
  inputSchema: {
    type: "object",
    properties: {
      root: { type: "string", description: "The flow's root item: iNNN or item:<task>." },
      step: { type: "string", description: "The template step id, e.g. deploy_prod." },
      reason: { type: "string" },
    },
    required: ["root", "step", "reason"],
    additionalProperties: false,
  },
  handler: (input) => handle(input),
} satisfies ToolDef;
