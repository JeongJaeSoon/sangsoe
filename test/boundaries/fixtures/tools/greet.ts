import type { ToolDef } from "../../../../claude-plugin/mcp/contract.ts";
import { greet } from "../greet.ts";

export default {
  name: "greet",
  description: "Greet someone, or refuse when asked.",
  inputSchema: {
    type: "object",
    properties: { who: { type: "string" }, refuse: { type: "boolean" } },
    additionalProperties: false,
  },
  handler: (input) => greet((input.who as string | undefined) ?? "world", input.refuse === true),
} satisfies ToolDef;
