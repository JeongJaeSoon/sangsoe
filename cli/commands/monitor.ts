import { isMonitorName, MONITOR_NAMES, type MonitorReport, type MonitorRunner, openMonitors } from "../../core/index.ts";
import type { CommandArgs, CommandDef, Outcome } from "../contract.ts";

// --home: the directory whose .config/sangsoe/config.json (watch, owners, verify_tier) the round reads.
const USAGE = `run <${MONITOR_NAMES.join("|")}> [--dry-run] [--db <path>] [--home <dir>]`;

// The precheck entrance (decision 84 ②'s T2 fallback): the same round the plugin worker's timer
// runs, once. U3's T2 passed, so the worker timer is the default path and this is for a shell.
export async function monitor(
  positionals: readonly string[],
  values: CommandArgs["values"],
  open: (o: { dryRun: boolean; dbPath?: string; home?: string }) => MonitorRunner = openMonitors,
): Promise<Outcome<MonitorReport>> {
  const [verb, name] = positionals;
  if (verb !== "run" || name === undefined || !isMonitorName(name)) {
    return { ok: false, refusal: { code: "invalid_input", reason: `expected ${USAGE}`, fix: `sangsoe monitor ${USAGE}` } };
  }
  const dbPath = typeof values.db === "string" && values.db !== "" ? values.db : undefined;
  const home = typeof values.home === "string" && values.home !== "" ? values.home : undefined;
  const runner = open({ dryRun: values["dry-run"] === true, ...(dbPath ? { dbPath } : {}), ...(home ? { home } : {}) });
  try {
    return { ok: true, value: await runner.run(name) };
  } finally {
    runner.close();
  }
}

export default {
  name: "monitor",
  summary: "run one monitor round (orca, resource, chat, pr, queue); --dry-run prints the events and Orca writes it would make",
  usage: USAGE,
  maxPositionals: 2,
  options: { "dry-run": { type: "boolean" }, db: { type: "string" }, home: { type: "string" } },
  run: ({ positionals, values }) => monitor(positionals, values),
} satisfies CommandDef;
