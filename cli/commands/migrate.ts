import { existsSync } from "node:fs";
import {
  applyImport,
  createOrcaAdapter,
  defaultDbPath,
  defaultOldStorePath,
  type ImportPlan,
  importedFrom,
  NOTHING_IMPORTED,
  nodeExec,
  type OrcaAdapter,
  planImport,
  readOldState,
  Store,
} from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

// Ids, kinds and actions only: titles stay out of the output so a report can quote it.
const lines = (p: ImportPlan): string[] => [
  ...p.items.map((i) => `${i.id} item ${i.status} ${i.action}`),
  ...p.edges.map((e) => `${e.pred}>${e.succ} edge ${e.kind} ${e.action}`),
  ...p.decisions.map((d) => `${d.id} decision ${d.action}`),
];

export async function migrate(values: CommandArgs["values"], ports: { orca?: OrcaAdapter; store?: Store; storePath?: string } = {}): Promise<Outcome> {
  const from = typeof values.from === "string" ? values.from : defaultOldStorePath();
  const run = typeof values.run === "string" ? values.run : "";
  if (values.apply === true && values["dry-run"] === true) {
    return { ok: false, refusal: { code: "invalid_input", reason: "--apply and --dry-run together", fix: "pass one of them; --dry-run is the default" } };
  }
  if (values.apply === true && run.trim() === "") {
    return { ok: false, refusal: { code: "invalid_input", reason: "--apply needs the Run its Tasks go in", fix: "pass --run <run id>" } };
  }
  const old = readOldState(from);
  if (!old.ok) return old;

  if (values.apply !== true) {
    // A dry run never creates the sangsoe store: no store yet means nothing imported yet.
    const path = ports.storePath ?? defaultDbPath();
    const store = ports.store ?? (existsSync(path) ? Store.open({ path }) : undefined);
    try {
      const plan = planImport(old.value, store ? importedFrom(store) : NOTHING_IMPORTED);
      return { ok: true, value: { mode: "dry-run", from, counts: plan.counts, plan: lines(plan) } };
    } finally {
      if (store && !ports.store) store.close();
    }
  }
  const store = ports.store ?? Store.open();
  try {
    const r = await applyImport({ store, orca: ports.orca ?? createOrcaAdapter(nodeExec()) }, old.value, { run });
    return r.ok ? { ok: true, value: { mode: "apply", from, run, created: r.value.created, already: r.value.already } } : r;
  } finally {
    if (!ports.store) store.close();
  }
}

export default {
  name: "migrate",
  summary: "import agent-skills' open items and open decisions once, read-only on the old store (dry run unless --apply)",
  usage: "[--from <agent-skills.db>] [--dry-run | --apply --run <run id>]",
  options: {
    from: { type: "string" },
    run: { type: "string" },
    apply: { type: "boolean" },
    "dry-run": { type: "boolean" },
  },
  run: ({ values }) => migrate(values),
} satisfies CommandDef;
