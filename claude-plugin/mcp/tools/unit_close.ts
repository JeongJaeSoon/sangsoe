import { closeUnit, type GraphPorts, withGraphPorts } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

/** `caller` is the session's own terminal, read from the environment unless a test passes it. */
export const handle = (input: Record<string, unknown>, ports: GraphPorts = {}, caller: string | undefined = process.env.ORCA_TERMINAL_HANDLE): Promise<Outcome> =>
  withGraphPorts(ports, (deps) => closeUnit(deps, { dispatch: typeof input.dispatch === "string" ? input.dispatch : "", caller }));

export default {
  name: "unit_close",
  description:
    "Close a finished unit's agent terminal by its Dispatch id, only when Orca shows the Dispatch succeeded, failed or cancelled and its agent at rest with no wait, and the terminal is not your own. Otherwise refuses with the failed condition. Never closes a tab or a worktree.",
  inputSchema: {
    type: "object",
    properties: { dispatch: { type: "string", description: "the Dispatch id of the finished unit" } },
    required: ["dispatch"],
    additionalProperties: false,
  },
  handler: (input) => handle(input),
} satisfies ToolDef;
