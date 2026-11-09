import { createOrcaAdapter, handoffSave, nodeExec } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";

const field = (description: string) => ({ type: "string" as const, description });

export default {
  name: "handoff_save",
  description:
    "Save the four judgment states the store does not hold as one Orca handoff message in your own Run mailbox; the next session's SessionStart injects the last one once. Write 없음 for an empty field.",
  inputSchema: {
    type: "object",
    properties: {
      next: field("What to do next"),
      waiting: field("Answers you are waiting for, and from whom"),
      open_questions: field("Questions nobody has answered yet"),
      reply_to: field("Where the reply to the owner's request goes"),
    },
    required: ["next", "waiting", "open_questions", "reply_to"],
    additionalProperties: false,
  },
  handler: (input) => handoffSave({ orca: createOrcaAdapter(nodeExec()) }, input),
} satisfies ToolDef;
