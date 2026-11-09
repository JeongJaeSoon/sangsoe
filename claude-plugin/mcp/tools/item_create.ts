import { createItem, createOrcaAdapter, nodeExec, type OrcaAdapter, parseOwnerExtra, recordOwnerExtra, Store } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

/** Same Outcome as `sangsoe item new`; ports are passed in so tests drive it with a fake Orca. */
export async function handle(input: Record<string, unknown>, ports: { orca: OrcaAdapter; store: Store }): Promise<Outcome> {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const deps = Array.isArray(input.deps) ? input.deps.map(String) : undefined;
  const extra = parseOwnerExtra(input.verify, input.cmdHint);
  if (!extra.ok) return { ok: false, refusal: { code: "invalid_verify", reason: extra.error, fix: FIX.invalid_verify } };
  const r = await createItem(ports.orca, ports.store, {
    run: s("runId"),
    spec: s("spec"),
    who: s("who"),
    doneWhen: s("doneWhen"),
    ...(s("title") ? { title: s("title") } : {}),
    ...(deps?.length ? { deps } : {}),
  });
  if (r.ok) recordOwnerExtra(ports.store, r.task, extra.value);
  return r.ok ? { ok: true, value: { task: r.task, alias: r.alias } } : { ok: false, refusal: { code: r.code, reason: r.error, fix: FIX[r.code] } };
}

// Same mapping as `sangsoe item new`, so both entrances give the same Outcome.
const FIX = {
  invalid_input: "give run, spec, who and done-when, none empty",
  task_create_failed: "check that the Run id is right and the deps are Tasks of that Run",
  invalid_verify: "verify is one of pr_merged{pr} · orca_field{target,field,value} · plugin_approved{key} · run_ok{repo} · pr_found{repo,search}; cmdHint a non-empty command prefix",
} as const;

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
      verify: {
        type: "object",
        description:
          "Owner items: the observed fact that shows the owner did it (decision 91②). kind is one of pr_merged{pr: owner/repo#N}, orca_field{target, field, value}, plugin_approved{key}, run_ok{repo}, pr_found{repo, search}; run_ok and pr_found are read only after the owner's `!` line matched cmdHint.",
      },
      cmdHint: { type: "string", description: "Owner items: the command's prefix and key arguments, e.g. `gh workflow run promote.yml`; an owner `!` line containing every piece links to this item." },
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
