import { lazyStore, nodeExec, type RecordInput, resourceRecord } from "../../../core/index.ts";
import type { ToolDef } from "../contract.ts";

export default {
  name: "resource_record",
  description:
    "Record a Docker id you just made (container, volume, network, built image), or every id a compose project made, with the Task or worktree that owns it. REAPER clears only recorded ids, after the owner's work is finished.",
  inputSchema: {
    type: "object",
    properties: {
      owner: { type: "string", description: "Your Orca Task id or worktree instance id" },
      kind: { type: "string", description: "container, volume, network or image" },
      ref: { type: "string", description: "The Docker id or name" },
      compose: { type: "string", description: "A compose project name, instead of kind and ref" },
      action: { type: "string", enum: ["created", "released"] },
    },
    required: ["owner"],
    additionalProperties: false,
  },
  async handler(input) {
    const store = lazyStore();
    try {
      return await resourceRecord(store, nodeExec(30_000), input as RecordInput);
    } finally {
      store.close();
    }
  },
} satisfies ToolDef;
