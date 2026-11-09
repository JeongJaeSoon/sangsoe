import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import type { ViewInput } from "../contract/views.ts";
import type { Result } from "../notify/result.ts";
import { refuse } from "../notify/result.ts";
import { Store } from "../store/store.ts";
import { addEdge, type EdgeInput, type EdgeWritten, removeEdge } from "./edit.ts";
import { type Expanded, expandFlow, type FlowPlan, loadFlow, planFlow } from "./flow.ts";
import { readSnapshot } from "./snapshot.ts";
import { TomlError } from "./toml.ts";

// What the `graph` CLI commands and the edge/flow MCP tools share: open the ports (or take a test's),
// read the named Runs, run one core call, close what was opened.

export interface GraphPorts {
  readonly orca?: OrcaAdapter;
  readonly store?: Store;
  readonly now?: () => string;
}

export async function withGraphPorts<T>(ports: GraphPorts, fn: (deps: { orca: OrcaAdapter; store: Store }) => Promise<T>): Promise<T> {
  const store = ports.store ?? Store.open();
  try {
    return await fn({ orca: ports.orca ?? createOrcaAdapter(nodeExec()), store });
  } finally {
    if (!ports.store) store.close();
  }
}

/** A ViewInput over the named Runs; a Run that cannot be read is a refusal, never an empty graph. */
export async function readInput(deps: { orca: OrcaAdapter; store: Store }, runs: readonly string[], now: string): Promise<Result<ViewInput>> {
  if (runs.length === 0) return refuse("invalid_input", "name at least one Run to read", "pass --run <run id> (repeatable)");
  const r = await readSnapshot(deps.orca, runs);
  if (r.unread.length > 0) return refuse("orca_unreadable", `task-list failed: ${r.unread.map((u) => `${u.run} ${u.error}`).join("; ")}`, "retry once Orca answers");
  return { ok: true, value: { orca: r.snapshot, events: deps.store.events(), now } };
}

export const graphAdd = (ports: GraphPorts, a: EdgeInput & { runs: readonly string[] }): Promise<Result<EdgeWritten>> =>
  withGraphPorts(ports, (deps) => addEdge(deps, a));

export const graphRemove = (ports: GraphPorts, a: EdgeInput & { reason: string; runs: readonly string[] }): Promise<Result<EdgeWritten>> =>
  withGraphPorts(ports, (deps) => removeEdge(deps, a));

export interface ExpandInput {
  readonly template: string;
  readonly vars: Readonly<Record<string, string>>;
  readonly run: string;
  readonly who: string;
  readonly requestId: string;
  readonly dryRun?: boolean;
  /** Where templates are looked up; default ~/.config/sangsoe/flows then the bundled ones. */
  readonly flowDirs?: readonly string[];
}

/** `graph expand` / `flow_expand`: --dry-run returns the plan and writes nothing. */
export async function graphExpand(ports: GraphPorts, a: ExpandInput): Promise<Result<FlowPlan | Expanded>> {
  let plan: Result<FlowPlan>;
  try {
    plan = planFlow(loadFlow(a.template, a.flowDirs), a.vars);
  } catch (e) {
    if (e instanceof TomlError) return refuse("bad_template", e.message, "fix the template, or name one under ~/.config/sangsoe/flows/ or the bundled ones");
    throw e;
  }
  if (!plan.ok || a.dryRun) return plan;
  if (a.run.trim() === "" || a.who.trim() === "") return refuse("invalid_input", "expanding needs a Run and an owner (who)", "pass run and who");
  const p = plan.value;
  return withGraphPorts(ports, (deps) => expandFlow(deps, { plan: p, run: a.run, who: a.who, requestId: a.requestId }));
}

/** `--run` may repeat or carry a comma list. */
export function runList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return raw.flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean);
}
