import type { ToolDef } from "../../../../claude-plugin/mcp/contract.ts";

export default {
  name: "empty",
  description: "Does nothing.",
  inputSchema: { type: "object", additionalProperties: false },
  handler: () => ({ ok: true, value: null }),
} satisfies ToolDef;
