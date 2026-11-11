import { decisionOpenFrom, defaultDeps } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";

export default {
  name: "decision_open",
  description:
    "Ask the owner a decision. The same subject and options asked before return the existing dNNN and answer instead of a new question; each waiting Task gets one Orca gate.",
  inputSchema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "item:iNNN or item:<task id> (a Task with no alias), or scope:<group> when no item" },
      question: { type: "string", description: "Shown on the Orca gate; not part of the decision key" },
      options: { type: "array", items: { type: "string" } },
      waiters: {
        type: "array",
        description: "Tasks that wait on the answer and the Run each sits in; every one must sit in this session's Run",
        items: {
          type: "object",
          properties: { task: { type: "string" }, run: { type: "string" } },
          required: ["task", "run"],
          additionalProperties: false,
        },
      },
      carrier_run: { type: "string", description: "The orchestrator Run, used when no Task waits" },
    },
    required: ["subject", "question"],
    additionalProperties: false,
  },
  handler: (input) => decisionOpenFrom(input, defaultDeps),
} satisfies ToolDef;
