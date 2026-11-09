import { decisionAnswerFrom, defaultDeps } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";

export default {
  name: "decision_answer",
  description:
    "Link the owner's recorded answer to an open dNNN: closes the decision, resolves this Run's gates and tells each waiting worker once. Safe to call again.",
  inputSchema: {
    type: "object",
    properties: {
      decision: { type: "string", description: "dNNN" },
      answer: { type: "string", description: "The owner's answer, already masked" },
      owner_action: { type: "integer", description: "seq of the owner_action the answer came from" },
      linked_by: { type: "string", enum: ["hook", "button", "orchestrator", "observed"] },
      run: { type: "string", description: "This session's Run; read from Orca when left out" },
    },
    required: ["decision", "answer", "owner_action"],
    additionalProperties: false,
  },
  handler: (input) => decisionAnswerFrom(input, defaultDeps),
} satisfies ToolDef;
