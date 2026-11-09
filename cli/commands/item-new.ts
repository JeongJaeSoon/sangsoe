import { createItem, createOrcaAdapter, nodeExec, type OrcaAdapter, parseOwnerExtra, recordOwnerExtra, Store } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

// Same mapping as the MCP tool item_create, so both entrances give the same Outcome.
const FIX = {
  invalid_input: "give run, spec, who and done-when, none empty",
  task_create_failed: "check that the Run id is right and the deps are Tasks of that Run",
  invalid_verify: "verify is one of pr_merged{pr} · orca_field{target,field,value} · plugin_approved{key} · run_ok{repo} · pr_found{repo,search}; cmdHint a non-empty command prefix",
} as const;

function verifyJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (raw === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "verify: not JSON" };
  }
}

/** It does not start a session (start_unit does). */
export async function itemNew(values: CommandArgs["values"], ports: { orca?: OrcaAdapter; store?: Store } = {}): Promise<Outcome> {
  const str = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : "");
  const deps = str("deps")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const json = verifyJson(str("verify"));
  const extra = json.ok ? parseOwnerExtra(json.value, typeof values["cmd-hint"] === "string" ? values["cmd-hint"] : undefined) : json;
  if (!extra.ok) return { ok: false, refusal: { code: "invalid_verify", reason: extra.error, fix: FIX.invalid_verify } };
  const store = ports.store ?? Store.open();
  try {
    const r = await createItem(ports.orca ?? createOrcaAdapter(nodeExec()), store, {
      run: str("run"),
      spec: str("spec"),
      who: str("who"),
      doneWhen: str("done-when"),
      ...(str("title") ? { title: str("title") } : {}),
      ...(deps.length ? { deps } : {}),
    });
    if (r.ok) recordOwnerExtra(store, r.task, extra.value);
    return r.ok ? { ok: true, value: { task: r.task, alias: r.alias } } : { ok: false, refusal: { code: r.code, reason: r.error, fix: FIX[r.code] } };
  } finally {
    if (!ports.store) store.close();
  }
}

export default {
  name: "item new",
  summary: "create an item's Orca Task (task-create --deps) and its iNNN alias; starting it is start_unit's",
  usage: "--run <run id> --spec <text> --who <owner> --done-when <text> [--title <t>] [--deps <task,task>] [--verify <json>] [--cmd-hint <text>]",
  options: {
    run: { type: "string" },
    spec: { type: "string" },
    title: { type: "string" },
    deps: { type: "string" },
    who: { type: "string" },
    "done-when": { type: "string" },
    verify: { type: "string" },
    "cmd-hint": { type: "string" },
  },
  run: ({ values }) => itemNew(values),
} satisfies CommandDef;
