import type { ToolDef } from "../../../../claude-plugin/mcp/contract.ts";

export default {
  name: "throws",
  description: "Throws a non-Error value.",
  inputSchema: { type: "object", properties: { bare: { type: "boolean" } } },
  handler: (input) => {
    throw input.bare ? Object.create(null) : null;
  },
} satisfies ToolDef;
