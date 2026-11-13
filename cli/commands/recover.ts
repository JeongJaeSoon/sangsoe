import {
  authRecover,
  createOrcaAdapter,
  nodeExec,
  type OrcaAdapter,
  recoverPlan,
  renderAuthRecover,
  renderRecover,
  Store,
} from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome, Report } from "../contract.ts";

const USAGE = "[--run <run id>] [--limit <n>] | auth [--send] [--db <path>]";

export async function recover(
  values: CommandArgs["values"],
  orca: OrcaAdapter = createOrcaAdapter(nodeExec()),
  positionals: readonly string[] = [],
  /** A caller that passes its own store keeps it open. */
  open?: () => Store,
): Promise<Outcome | Report> {
  const refuse = (reason: string): Outcome => ({ ok: false, refusal: { code: "invalid_input", reason, fix: `sangsoe recover ${USAGE}` } });
  if (positionals.length > 0 && positionals[0] !== "auth") return refuse(`unknown subcommand ${positionals[0]}`);
  if (positionals[0] === "auth") {
    if (values.run !== undefined || values.limit !== undefined) return refuse("recover auth takes only --send and --db");
    const send = values.send === true;
    const path = typeof values.db === "string" && values.db !== "" ? values.db : undefined;
    const store = (open ?? (() => Store.open(path ? { path } : {})))();
    try {
      const r = await authRecover(store, orca, { send });
      const bad = r.rows.some((x) => x.verdict === "failed" || x.unread);
      return { code: bad ? 1 : 0, lines: renderAuthRecover(r, send) };
    } finally {
      if (!open) store.close();
    }
  }
  if (values.send !== undefined || values.db !== undefined) return refuse("--send and --db belong to recover auth");
  const run = typeof values.run === "string" && values.run !== "" ? values.run : undefined;
  const limit = typeof values.limit === "string" ? Number(values.limit) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    return { ok: false, refusal: { code: "invalid_input", reason: "--limit must be a positive integer", fix: "sangsoe recover --limit 50" } };
  }
  const plan = await recoverPlan(orca, { ...(run ? { run } : {}), ...(limit ? { limit } : {}) });
  return { code: "error" in plan ? 1 : 0, lines: renderRecover(plan) };
}

export default {
  name: "recover",
  summary:
    "read-only table of supervised workers after a restart (⚠️: neither live nor settled); auth lists sessions stopped on a lost login and, with --send, sends each one recovery line",
  usage: USAGE,
  maxPositionals: 1,
  options: { run: { type: "string" }, limit: { type: "string" }, send: { type: "boolean" }, db: { type: "string" } },
  run: ({ values, positionals }) => recover(values, undefined, positionals),
} satisfies CommandDef;
