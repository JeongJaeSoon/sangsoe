import type { ToolDef } from "../../../../claude-plugin/mcp/contract.ts";

export default {
  name: "throws",
  description: "Throws a non-Error value.",
  inputSchema: { type: "object" },
  handler: () => {
    throw null;
  },
} satisfies ToolDef;
