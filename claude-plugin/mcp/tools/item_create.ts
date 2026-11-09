import { createItem, createOrcaAdapter, nodeExec, type OrcaAdapter, Store } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

/** Same Outcome as `sangsoe item new`; ports are passed in so tests drive it with a fake Orca. */
export async function handle(input: Record<string, unknown>, ports: { orca: OrcaAdapter; store: Store }): Promise<Outcome> {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const deps = Array.isArray(input.deps) ? input.deps.map(String) : undefined;
  const r = await createItem(ports.orca, ports.store, {
    run: s("runId"),
    spec: s("spec"),
    who: s("who"),
    doneWhen: s("doneWhen"),
    ...(s("title") ? { title: s("title") } : {}),
    ...(deps?.length ? { deps } : {}),
  });
  return r.ok
    ? { ok: true, value: { task: r.task, alias: r.alias } }
    : { ok: false, refusal: { code: "task_create_failed", reason: r.error, fix: "check that the Run id is right and the deps are Tasks of that Run" } };
}

export default {
  name: "item_create",
  description: "Create an item: its Orca Task (with deps) and its iNNN alias. Does not start a session; use start_unit for that.",
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string" },
      spec: { type: "string", description: "The Task's brief, acceptance criteria included. A /goal line in it does not take effect on a worker." },
      title: { type: "string" },
      deps: { type: "array", items: { type: "string" } },
      who: { type: "string", description: "Who owns the item, e.g. lead:api." },
      doneWhen: { type: "string", description: "One line: when the item is done." },
    },
    required: ["runId", "spec", "who", "doneWhen"],
    additionalProperties: false,
  },
  async handler(input) {
    const store = Store.open();
    try {
      return await handle(input, { orca: createOrcaAdapter(nodeExec()), store });
    } finally {
      store.close();
    }
  },
} satisfies ToolDef;
