import { existsSync } from "node:fs";
import { createOrcaAdapter, type Host, nodeExec, type OrcaAdapter, restartSessions, Store } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome, Report } from "../contract.ts";

const USAGE = "--stale [--dry-run] | --task <task id> [--dry-run]";

export async function restart(
  values: CommandArgs["values"],
  host: Host,
  orca: OrcaAdapter = createOrcaAdapter(nodeExec(180_000)),
  /** A caller that passes its own store keeps it open. */
  open?: () => Store,
): Promise<Outcome | Report> {
  const task = typeof values.task === "string" && values.task !== "" ? values.task : undefined;
  if ((values.stale === true) === (task !== undefined)) {
    return { ok: false, refusal: { code: "invalid_input", reason: "pass exactly one of --stale and --task", fix: `sangsoe restart ${USAGE}` } };
  }
  const store = (open ?? (() => Store.open()))();
  try {
    // Lines go out as they are made, so a caller's timeout still leaves what was done on screen.
    const out = await restartSessions(
      {
        orca,
        store,
        host,
        self: { pid: process.pid, cwd: process.cwd(), terminal: host.env.ORCA_TERMINAL_HANDLE },
        exists: existsSync,
        emit: (line) => process.stdout.write(`${line}\n`),
      },
      { ...(task ? { task } : {}), dryRun: values["dry-run"] === true },
    );
    return { code: out.code, lines: [] };
  } finally {
    if (!open) store.close();
  }
}

export default {
  name: "restart",
  summary:
    "restart the sangsoe sessions the caller started whose MCP server runs stale code (--stale), or one child Task's session (--task): worker-stop, claude --resume in a new terminal, then start_unit's resume; --dry-run prints the plan",
  usage: USAGE,
  options: { stale: { type: "boolean" }, task: { type: "string" }, "dry-run": { type: "boolean" } },
  run: ({ values, host }) => restart(values, host),
} satisfies CommandDef;
