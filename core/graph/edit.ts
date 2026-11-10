import { dedupeKey, EVENTS } from "../contract/index.ts";
import type { OrcaSnapshot } from "../contract/views.ts";
import type { CoreDeps, Result } from "../notify/result.ts";
import { done, refuse } from "../notify/result.ts";
import { EDGE_KINDS, type EdgeKind, edgeId, type Facts, foldFacts } from "./facts.ts";
import { itemRef, parseNode } from "./nodes.ts";
import { readSnapshot } from "./snapshot.ts";

export const GRAPH_SOURCE = "GRAPH";

export interface EdgeInput {
  readonly pred: string;
  readonly succ: string;
  readonly kind: string;
}

export interface EdgeWritten {
  readonly status: "added" | "already" | "removed";
  readonly pred: string;
  readonly succ: string;
  readonly kind: EdgeKind;
  /** Where the edge lives: Orca deps (made at creation) or an extra edge event. */
  readonly where: "orca" | "extra";
}

const PRED_KINDS: Readonly<Record<string, readonly EdgeKind[]>> = {
  item: EDGE_KINDS,
  pr: ["blocks", "after", "stacked_on", "deploys_after"],
  decision: ["blocks"],
};

/** `i001`, `item:i001` and `item:<task>` all name the same item; a PR or decision name passes through. */
export function resolveRef(ref: string, facts: Facts): string {
  const bare = ref.startsWith("item:") ? ref.slice(5) : ref;
  const task = facts.aliases.get(bare);
  if (task) return itemRef(task);
  if (/^d[0-9]{3,}$/.test(ref)) return `decision:${ref}`;
  if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9][0-9]*$/.test(ref)) return `pr:${ref}`;
  return ref.includes(":") ? ref : itemRef(ref);
}

/** Item → item adjacency over both homes: Orca deps and extra edges. */
export function successors(facts: Facts, snapshot: OrcaSnapshot): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const s = out.get(a) ?? new Set<string>();
    out.set(a, s.add(b));
  };
  for (const t of snapshot.tasks) for (const d of t.deps) link(itemRef(d), itemRef(t.id));
  for (const e of facts.edges) link(e.pred, e.succ);
  return out;
}

/** The path succ → … → pred when adding pred → succ would close a cycle, else undefined. */
export function cycleThrough(pred: string, succ: string, adj: ReadonlyMap<string, ReadonlySet<string>>): string[] | undefined {
  if (pred === succ) return [pred, succ];
  const from = new Map<string, string>();
  const queue = [succ];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const n = queue.shift() as string;
    if (n === pred) {
      const path = [n];
      for (let c = n; c !== succ; ) {
        c = from.get(c) as string;
        path.unshift(c);
      }
      return [...path, succ];
    }
    for (const m of adj.get(n) ?? []) {
      if (seen.has(m)) continue;
      seen.add(m);
      from.set(m, n);
      queue.push(m);
    }
  }
  return undefined;
}

type Checked = { ok: true; pred: string; succ: string; kind: EdgeKind } | { ok: false; refusal: { code: string; reason: string; fix: string } };

function check(input: EdgeInput, facts: Facts, snapshot: OrcaSnapshot): Checked {
  if (!(EDGE_KINDS as readonly string[]).includes(input.kind)) {
    return refuse("invalid_input", `kind ${JSON.stringify(input.kind)} is not an edge kind`, `use one of ${EDGE_KINDS.join(", ")}`);
  }
  const kind = input.kind as EdgeKind;
  const pred = resolveRef(input.pred, facts);
  const succ = resolveRef(input.succ, facts);
  const p = parseNode(pred);
  const s = parseNode(succ);
  if (!p) return refuse("invalid_input", `pred ${JSON.stringify(input.pred)} is not an item, PR or decision`, "name an iNNN, item:<task>, owner/repo#N or dNNN");
  if (s?.kind !== "item") return refuse("succ_not_item", `succ ${JSON.stringify(input.succ)} is not an item`, "a successor is always an item: iNNN or item:<task>");
  if (!PRED_KINDS[p.kind]?.includes(kind)) {
    return refuse("invalid_input", `a ${p.kind} predecessor cannot take a ${kind} edge`, `use ${PRED_KINDS[p.kind]?.join(" or ")}`);
  }
  const known = (task: string) => snapshot.tasks.some((t) => t.id === task) || facts.items.get(task)?.alias !== undefined;
  for (const n of [p, s]) {
    if (n.kind === "item" && !known(n.task)) return refuse("unknown_item", `no item ${n.task}`, "create the item first (item_create), or read its Run");
  }
  return { ok: true, pred, succ, kind };
}

/** `graph add`: the one entrance for an edge after creation. Refuses a cycle with the nodes that close it. */
export function addEdgeTo(deps: Pick<CoreDeps, "store">, snapshot: OrcaSnapshot, input: EdgeInput): Result<EdgeWritten> {
  const facts = foldFacts(deps.store.events());
  const c = check(input, facts, snapshot);
  if (!c.ok) return c;
  const { pred, succ, kind } = c;
  const succTask = succ.slice(5);
  if (kind === "blocks" && snapshot.tasks.find((t) => t.id === succTask)?.deps.some((d) => itemRef(d) === pred)) {
    return done({ status: "already", pred, succ, kind, where: "orca" });
  }
  const cycle = cycleThrough(pred, succ, successors(facts, snapshot));
  if (cycle) return refuse("cycle", `edge ${pred} → ${succ} would close a cycle: ${cycle.join(" → ")}`, "remove an edge on that cycle first, or add the edge the other way");
  const id = edgeId(pred, succ, kind);
  const n = facts.removals.get(id) ?? 0;
  try {
    const row = deps.store.append({
      type: "edge_added",
      source: GRAPH_SOURCE,
      entity: "edge",
      entity_id: id,
      subject: succ,
      dedupe_key: dedupeKey(EVENTS.edge_added, pred, succ, kind, ...(n > 0 ? [String(n)] : [])),
      payload: { pred, succ, kind },
    });
    return done({ status: row.inserted ? "added" : "already", pred, succ, kind, where: "extra" });
  } catch (e) {
    if (/edge would create a cycle/.test(String(e))) {
      return refuse("cycle", `edge ${pred} → ${succ} would close a cycle (store trigger)`, "remove an edge on that cycle first");
    }
    throw e;
  }
}

export function removeEdgeFrom(deps: Pick<CoreDeps, "store">, snapshot: OrcaSnapshot, input: EdgeInput & { reason: string }): Result<EdgeWritten> {
  if (input.reason.trim() === "") return refuse("invalid_input", "removing an edge needs a reason", "pass a reason");
  const facts = foldFacts(deps.store.events());
  const c = check(input, facts, snapshot);
  if (!c.ok) return c;
  const { pred, succ, kind } = c;
  if (!facts.edges.some((e) => e.pred === pred && e.succ === succ && e.kind === kind)) {
    const inOrca = kind === "blocks" && snapshot.tasks.find((t) => itemRef(t.id) === succ)?.deps.some((d) => itemRef(d) === pred);
    return inOrca
      ? refuse("orca_dep", `${pred} → ${succ} is an Orca dep made at creation`, "create the successor Task again without that dep and cancel this one")
      : refuse("no_edge", `no ${kind} edge ${pred} → ${succ}`, "graph why <item> lists the edges into it");
  }
  deps.store.append({
    type: "edge_removed",
    source: GRAPH_SOURCE,
    entity: "edge",
    entity_id: edgeId(pred, succ, kind),
    subject: succ,
    payload: { pred, succ, kind, reason: input.reason },
  });
  return done({ status: "removed", pred, succ, kind, where: "extra" });
}

export interface SkipInput {
  /** The flow's root item: `iNNN`, `item:<task>` or the bare task id. */
  readonly root: string;
  readonly step: string;
  readonly reason: string;
}

export interface SkipWritten {
  readonly status: "skipped" | "already";
  readonly root: string;
  readonly step: string;
}

/** `flow_step_skip`: a template step the flow will not have, with the reason `flow_gap` then accepts. */
export function skipFlowStep(deps: Pick<CoreDeps, "store">, input: SkipInput): Result<SkipWritten> {
  if (input.reason.trim() === "") return refuse("invalid_input", "skipping a step needs a reason", "pass a reason");
  const facts = foldFacts(deps.store.events());
  const node = parseNode(resolveRef(input.root, facts));
  if (node?.kind !== "item") return refuse("invalid_input", `root ${JSON.stringify(input.root)} is not an item`, "name the flow's root item: iNNN or item:<task>");
  const flow = facts.flows.find((f) => f.parent === node.task);
  if (!flow) return refuse("no_flow", `no flow was expanded under ${node.task}`, "name the root item flow_expand returned");
  if (!flow.steps.includes(input.step)) return refuse("unknown_step", `${flow.flow} has no step ${JSON.stringify(input.step)}`, `use one of ${flow.steps.join(", ")}`);
  const subject = itemRef(node.task);
  const row = deps.store.append({
    type: "flow_step_skipped",
    source: GRAPH_SOURCE,
    subject,
    dedupe_key: dedupeKey(EVENTS.flow_step_skipped, node.task, input.step),
    payload: { step: input.step, reason: input.reason },
  });
  return done({ status: row.inserted ? "skipped" : "already", root: subject, step: input.step });
}

/** Reads the named Runs first, so a cycle through Orca deps is seen and an unknown item refused. */
export async function addEdge(deps: CoreDeps, input: EdgeInput & { runs: readonly string[] }): Promise<Result<EdgeWritten>> {
  const r = await readSnapshot(deps.orca, input.runs);
  if (r.unread.length > 0) return refuse("orca_unreadable", `task-list failed: ${r.unread.map((u) => `${u.run} ${u.error}`).join("; ")}`, "retry once Orca answers");
  return addEdgeTo(deps, r.snapshot, input);
}

export async function removeEdge(deps: CoreDeps, input: EdgeInput & { reason: string; runs: readonly string[] }): Promise<Result<EdgeWritten>> {
  const r = await readSnapshot(deps.orca, input.runs);
  if (r.unread.length > 0) return refuse("orca_unreadable", `task-list failed: ${r.unread.map((u) => `${u.run} ${u.error}`).join("; ")}`, "retry once Orca answers");
  return removeEdgeFrom(deps, r.snapshot, input);
}
