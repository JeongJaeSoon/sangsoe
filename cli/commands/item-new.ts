import { parseArgs } from "node:util";
import { createItem, createOrcaAdapter, nodeExec, type OrcaAdapter, Store } from "../../core/index.ts";

export const USAGE = `usage: sangsoe item new --run <run id> --spec <text> --who <owner> --done-when <text> [--title <t>] [--deps <task,task>]

Creates the item's Orca Task (task-create --deps) and binds its iNNN alias. It does not start a
session: starting goes through the core start function only (MCP tool start_unit).`;

export async function itemNew(
  argv: readonly string[],
  ports: { orca?: OrcaAdapter; store?: Store } = {},
): Promise<{ code: number; out: string }> {
  let v: Record<string, string | boolean | undefined>;
  try {
    v = parseArgs({
      args: [...argv],
      options: {
        run: { type: "string" },
        spec: { type: "string" },
        title: { type: "string" },
        deps: { type: "string" },
        who: { type: "string" },
        "done-when": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (err) {
    return { code: 2, out: `${(err as Error).message}\n${USAGE}` };
  }
  if (v.help) return { code: 0, out: USAGE };
  const str = (k: string) => (typeof v[k] === "string" && v[k] !== "" ? (v[k] as string) : undefined);
  const run = str("run");
  const spec = str("spec");
  const who = str("who");
  const doneWhen = str("done-when");
  if (!run || !spec || !who || !doneWhen) return { code: 2, out: `--run, --spec, --who and --done-when are required\n${USAGE}` };
  const deps = str("deps")?.split(",").map((d) => d.trim()).filter(Boolean);
  const title = str("title");
  const store = ports.store ?? Store.open();
  const r = await createItem(ports.orca ?? createOrcaAdapter(nodeExec()), store, {
    run,
    spec,
    who,
    doneWhen,
    ...(title ? { title } : {}),
    ...(deps?.length ? { deps } : {}),
  });
  if (!ports.store) store.close();
  return r.ok ? { code: 0, out: `${r.alias} ${r.task}` } : { code: 1, out: r.error };
}
