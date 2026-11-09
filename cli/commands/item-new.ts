import { createItem, createOrcaAdapter, nodeExec, type OrcaAdapter, Store } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

const FORM = "sangsoe item new --run <run id> --spec <text> --who <owner> --done-when <text>";

/** Same Outcome as the MCP tool item_create; it does not start a session (start_unit does). */
export async function itemNew(values: CommandArgs["values"], ports: { orca?: OrcaAdapter; store?: Store } = {}): Promise<Outcome> {
  const str = (k: string) => (typeof values[k] === "string" && values[k] !== "" ? (values[k] as string) : undefined);
  const run = str("run");
  const spec = str("spec");
  const who = str("who");
  const doneWhen = str("done-when");
  if (!run || !spec || !who || !doneWhen) {
    return { ok: false, refusal: { code: "invalid_input", reason: "--run, --spec, --who and --done-when are required", fix: FORM } };
  }
  const deps = str("deps")
    ?.split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const title = str("title");
  const store = ports.store ?? Store.open();
  try {
    const r = await createItem(ports.orca ?? createOrcaAdapter(nodeExec()), store, {
      run,
      spec,
      who,
      doneWhen,
      ...(title ? { title } : {}),
      ...(deps?.length ? { deps } : {}),
    });
    return r.ok
      ? { ok: true, value: { task: r.task, alias: r.alias } }
      : { ok: false, refusal: { code: "task_create_failed", reason: r.error, fix: "check that the Run id is right and the deps are Tasks of that Run" } };
  } finally {
    if (!ports.store) store.close();
  }
}

export default {
  name: "item new",
  summary: "create an item's Orca Task (task-create --deps) and its iNNN alias; starting it is start_unit's",
  usage: "--run <run id> --spec <text> --who <owner> --done-when <text> [--title <t>] [--deps <task,task>]",
  options: {
    run: { type: "string" },
    spec: { type: "string" },
    title: { type: "string" },
    deps: { type: "string" },
    who: { type: "string" },
    "done-when": { type: "string" },
  },
  run: ({ values }) => itemNew(values),
} satisfies CommandDef;
