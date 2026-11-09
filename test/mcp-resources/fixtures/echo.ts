import type { ResourceDef } from "../../../claude-plugin/mcp/contract.ts";

export default {
  name: "echo",
  uriTemplate: "test://item/{task}/timeline",
  description: "Returns the variable it was read with.",
  mimeType: "application/json",
  read: (vars) => JSON.stringify(vars),
} satisfies ResourceDef;
