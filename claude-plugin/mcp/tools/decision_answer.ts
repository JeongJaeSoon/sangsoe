import { decisionAnswerFrom, defaultDeps } from "../../../core/index.ts";

// Shaped as U5's ToolDef (claude-plugin/mcp/contract.ts once it lands); the server registers it by file name.
export default {
  name: "decision_answer",
  description:
    "Link the owner's recorded answer to an open dNNN: closes the decision, resolves this Run's gates and tells each waiting worker once. Safe to call again.",
  inputSchema: {
    type: "object" as const,
    properties: {
      decision: { type: "string" as const, description: "dNNN" },
      answer: { type: "string" as const, description: "The owner's answer, already masked" },
      owner_action: { type: "integer" as const, description: "seq of the owner_action the answer came from" },
      linked_by: { type: "string" as const, enum: ["hook", "button", "orchestrator", "observed"] },
      run: { type: "string" as const, description: "This session's Run; read from Orca when left out" },
    },
    required: ["decision", "answer", "owner_action"],
    additionalProperties: false,
  },
  async handler(input: Record<string, unknown>) {
    const deps = defaultDeps();
    try {
      return await decisionAnswerFrom(input, deps);
    } finally {
      deps.store.close();
    }
  },
};
