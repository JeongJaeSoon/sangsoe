import { type GraphPorts, retireItem, withGraphPorts } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

const s = (input: Record<string, unknown>, k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");

/** Same Outcome as `sangsoe item retire`. */
export const handle = (input: Record<string, unknown>, ports: GraphPorts = {}): Promise<Outcome> =>
  withGraphPorts(ports, (deps) => retireItem(deps, { item: s(input, "item"), reason: s(input, "reason"), by: s(input, "by"), ...(s(input, "run") ? { run: s(input, "run") } : {}) }));

export default {
  name: "item_retire",
  description:
    "Retire a completed item whose PR closed without a merge, with who and why, so it reads 🗑️ and leaves the blocked counts. Any other item is refused; a second call is a no-op.",
  inputSchema: {
    type: "object",
    properties: {
      item: { type: "string", description: "iNNN or the Task id" },
      reason: { type: "string" },
      by: { type: "string", description: "owner, or lead:<name>" },
      run: { type: "string", description: "the item's Run, only for an item whose item_created names none" },
    },
    required: ["item", "reason", "by"],
    additionalProperties: false,
  },
  handler: (input) => handle(input),
} satisfies ToolDef;
