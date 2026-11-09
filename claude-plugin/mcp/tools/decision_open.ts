import { decisionOpenFrom, defaultDeps } from "../../../core/index.ts";

// Shaped as U5's ToolDef (claude-plugin/mcp/contract.ts once it lands); the server registers it by file name.
export default {
  name: "decision_open",
  description:
    "Ask the owner a decision. The same subject and options asked before return the existing dNNN and answer instead of a new question; each waiting Task gets one Orca gate.",
  inputSchema: {
    type: "object" as const,
    properties: {
      subject: { type: "string" as const, description: "item:iNNN, or scope:<group> when no item" },
      question: { type: "string" as const, description: "Shown on the Orca gate; not part of the decision key" },
      options: { type: "array" as const, items: { type: "string" as const } },
      waiters: {
        type: "array" as const,
        description: "Tasks that wait on the answer and the Run each sits in",
        items: {
          type: "object" as const,
          properties: { task: { type: "string" as const }, run: { type: "string" as const } },
          required: ["task", "run"],
        },
      },
      carrier_run: { type: "string" as const, description: "The orchestrator Run, used when no Task waits" },
    },
    required: ["subject", "question"],
    additionalProperties: false,
  },
  async handler(input: Record<string, unknown>) {
    const deps = defaultDeps();
    try {
      return await decisionOpenFrom(input, deps);
    } finally {
      deps.store.close();
    }
  },
};
