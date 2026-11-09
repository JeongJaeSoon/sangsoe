import { configuredReviewers, reviewAskRecord, Store } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";

export default {
  name: "review_ask_record",
  description:
    "Record one review ask or reminder you sent (review_ask_sent). A reviewer missing from the sangsoe config is also raised as unmapped_reviewer.",
  inputSchema: {
    type: "object",
    properties: {
      pr: { type: "string", description: "owner/repo#N" },
      reviewer: { type: "string", description: "The reviewer's handle" },
      reminder: { type: "boolean", description: "true when this ask is a reminder" },
    },
    required: ["pr", "reviewer"],
    additionalProperties: false,
  },
  handler(input) {
    const store = Store.open();
    try {
      return reviewAskRecord(store, input, configuredReviewers());
    } finally {
      store.close();
    }
  },
} satisfies ToolDef;
