import { createItem, createOrcaAdapter, nodeExec, Store } from "../../../core/index.ts";

// Picked up by file name once the MCP server (U5) lands; the shape is its ToolDef.
export default {
  name: "item_new",
  description: "Create an item: its Orca Task (with deps) and its iNNN alias. Does not start a session; use start_unit for that.",
  inputSchema: {
    type: "object" as const,
    properties: {
      runId: { type: "string" as const },
      spec: { type: "string" as const, description: "First prompt of the Task, /goal line first." },
      title: { type: "string" as const },
      deps: { type: "array" as const, items: { type: "string" as const } },
      who: { type: "string" as const, description: "Who owns the item, e.g. lead:api." },
      doneWhen: { type: "string" as const, description: "One line: when the item is done." },
    },
    required: ["runId", "spec", "who", "doneWhen"],
    additionalProperties: false,
  },
  async handler(input: Record<string, unknown>) {
    const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
    const deps = Array.isArray(input.deps) ? input.deps.map(String) : undefined;
    const store = Store.open();
    try {
      const r = await createItem(createOrcaAdapter(nodeExec()), store, {
        run: s("runId"),
        spec: s("spec"),
        who: s("who"),
        doneWhen: s("doneWhen"),
        ...(s("title") ? { title: s("title") } : {}),
        ...(deps ? { deps } : {}),
      });
      return r.ok
        ? { ok: true, value: { task: r.task, alias: r.alias } }
        : { ok: false, refusal: { code: "task_create_failed", reason: r.error, fix: "Run id 와 deps 가 같은 Run 의 Task 인지 확인한다" } };
    } finally {
      store.close();
    }
  },
};
