import { ContractError, createItem, createOrcaAdapter, EVENTS, isUnitClass, nodeExec, type OrcaAdapter, parseOwnerExtra, Store, UNIT_CLASSES } from "../../../core/index.ts";
import type { Outcome, ToolDef } from "../contract.ts";

/** Same Outcome as `sangsoe item new`; ports are passed in so tests drive it with a fake Orca. */
export async function handle(input: Record<string, unknown>, ports: { orca: OrcaAdapter; store: Store }): Promise<Outcome> {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const deps = Array.isArray(input.deps) ? input.deps.map(String) : undefined;
  const role = input.role;
  if (role !== undefined && role !== "lead" && role !== "worker") {
    return { ok: false, refusal: { code: "invalid_input", reason: `role "${String(role)}" is not lead or worker`, fix: FIX.invalid_role } };
  }
  const unitClass = input.class;
  if (unitClass !== undefined && (typeof unitClass !== "string" || !isUnitClass(unitClass) || role === "lead")) {
    return { ok: false, refusal: { code: "invalid_input", reason: `class "${String(unitClass)}" is not a worker unit class`, fix: FIX.invalid_class } };
  }
  const extra = parseOwnerExtra(input.verify, input.cmdHint);
  if (!extra.ok) return { ok: false, refusal: { code: "invalid_verify", reason: extra.error, fix: FIX.invalid_verify } };
  const fields: Record<string, unknown> = {
    ...(extra.value.verify ? { verify: extra.value.verify } : {}),
    ...(extra.value.cmdHint ? { cmd_hint: extra.value.cmdHint } : {}),
    ...Object.fromEntries(TIMING.filter((k) => input[k] !== undefined).map((k) => [k, input[k]])),
    ...(unitClass ? { unit_class: unitClass } : {}),
    ...(input.repo !== undefined ? { repo: input.repo } : {}),
    ...(input.lead !== undefined ? { lead: input.lead } : {}),
  };
  // Checked against the event contract before the Task exists: a row that fails after it would
  // leave an item with no trigger, visible as ready.
  try {
    EVENTS.item_extra_set.payload({ task: "unchecked", ...fields }, "item_extra_set");
  } catch (e) {
    if (!(e instanceof ContractError)) throw e;
    return { ok: false, refusal: { code: "invalid_input", reason: e.message, fix: FIX.invalid_timing } };
  }
  const r = await createItem(ports.orca, ports.store, {
    run: s("runId"),
    spec: s("spec"),
    who: s("who"),
    doneWhen: s("doneWhen"),
    ...(s("title") ? { title: s("title") } : {}),
    ...(deps?.length ? { deps } : {}),
    ...(role ? { role } : {}),
  });
  if (r.ok && Object.keys(fields).length > 0) {
    ports.store.append({ type: "item_extra_set", source: "core:item", payload: { task: r.task, ...fields }, entity: "task", entity_id: r.task });
  }
  return r.ok ? { ok: true, value: { task: r.task, alias: r.alias } } : { ok: false, refusal: { code: r.code, reason: r.error, fix: FIX[r.code] } };
}

// item_extra_set fields that decide when the item may start (decision 162).
const TIMING = ["trigger", "review_trigger", "hold", "exec_by"] as const;

// Same mapping as `sangsoe item new`, so both entrances give the same Outcome.
const FIX = {
  invalid_input: "give run, spec, who and done-when, none empty",
  task_create_failed: "check that the Run id is right and the deps are Tasks of that Run",
  invalid_role: "role is lead or worker: the session start_unit opens for this item",
  invalid_class: "class is default, hard, design or mechanical, and only for a worker item",
  invalid_timing: "trigger and review_trigger are non-empty text, hold a boolean, exec_by owner, lead or worker, repo an Orca repo selector (id:, name: or path:), lead text",
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
      role: {
        type: "string",
        enum: ["lead", "worker"],
        description: "The role of the session start_unit will open for it (its spec's first line); default worker. start_unit refuses another childRole.",
      },
      class: {
        type: "string",
        enum: [...UNIT_CLASSES],
        description:
          "Worker items: the unit class start_unit picks the model and advisor from (resource models). hard for a unit the lead judges hard; design for a root-cause or one-way-door call; mechanical for version bumps, link fixes and collection. Default: default.",
      },
      repo: {
        type: "string",
        description: "The Orca repo selector (id:, name: or path:) start_unit puts this item's worktree in, when it is not the starter's own repo.",
      },
      who: { type: "string", description: "Who owns the item, e.g. lead:api." },
      lead: {
        type: "string",
        description: "The lead group the item sits in: brief <group> and graph critical --lead name it. A lead making its own items passes its own name.",
      },
      doneWhen: { type: "string", description: "One line: when the item is done." },
      verify: {
        type: "object",
        description:
          "Owner items: the observed fact that shows the owner did it (decision 91②). kind is one of pr_merged{pr: owner/repo#N}, orca_field{target, field, value}, plugin_approved{key}, run_ok{repo}, pr_found{repo, search}; run_ok and pr_found are read only after the owner's `!` line matched cmdHint.",
      },
      cmdHint: { type: "string", description: "Owner items: the command's prefix and key arguments, e.g. `gh workflow run promote.yml`; an owner `!` line containing every piece links to this item." },
      trigger: {
        type: "string",
        description:
          "📅 scheduled: the item is not ready before this ISO date (2026-11-17 or a full timestamp) or until this PR (owner/repo#N) merges. Any other text is not ready and raises trigger_unclear for a lead to judge.",
      },
      hold: { type: "boolean", description: "⏸️ on hold: not ready until a lead or the owner reopens it." },
      review_trigger: { type: "string", description: "With hold: the condition, in words, to look at the item again." },
      exec_by: { type: "string", enum: ["owner", "lead", "worker"], description: "Who starts it; owner items go to the owner's to-do once ready." },
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
