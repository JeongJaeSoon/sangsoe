import { existsSync, readFileSync } from "node:fs";
import type { StoredEvent, ViewTaskStatus } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { isOpenGate } from "../decision/waiters.ts";
import { depsOf, type FullTaskRow, resultFields } from "../graph/snapshot.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import { defaultDbPath, Store } from "../store/store.ts";
import { replayJsonl } from "./replay.ts";
import type { BriefGate, BriefInput, BriefSnapshot, BriefTask } from "./types.ts";

const STATUSES: readonly ViewTaskStatus[] = ["pending", "ready", "dispatched", "blocked", "completed", "failed"];

/**
 * Runs the brief reads: the orchestrator's current Run and every Run an event names. item_created
 * carries no Run, so an item in another Run is seen only when `extra` names it.
 */
export function briefRuns(events: readonly StoredEvent[], current: string | null, extra: readonly string[] = []): string[] {
  const named = events.flatMap((e) => (typeof e.payload.run === "string" ? [e.payload.run] : []));
  return [...new Set([...(current ? [current] : []), ...named, ...extra])];
}

/** A deps value Orca gave that is not a string array reads as none, so one bad row does not fail the brief. */
function readableDeps(t: FullTaskRow): string[] {
  try {
    return depsOf(t.deps);
  } catch {
    return [];
  }
}

/** One Orca snapshot through the adapter: task-list --full and gate-list per Run, nothing cached. */
export async function readSnapshot(orca: OrcaAdapter, runs: readonly string[]): Promise<Result<BriefSnapshot>> {
  const tasks: BriefTask[] = [];
  const gates: BriefGate[] = [];
  for (const run of runs) {
    const tl = await orca.taskList({ run, full: true });
    if (!tl.ok) return refuse("orca_error", `task-list ${run}: ${tl.error.code} ${tl.error.message}`, "run sangsoe brief again once Orca answers");
    const gl = await orca.gateList({ run });
    if (!gl.ok) return refuse("orca_error", `gate-list ${run}: ${gl.error.code} ${gl.error.message}`, "run sangsoe brief again once Orca answers");
    for (const t of tl.value) {
      const status = (STATUSES as readonly string[]).includes(t.status) ? (t.status as ViewTaskStatus) : "pending";
      tasks.push({
        id: t.id,
        runId: run,
        status,
        deps: readableDeps(t as FullTaskRow),
        title: t.title,
        ...resultFields(t as FullTaskRow),
        ...(t.dispatchId ? { activeDispatchId: t.dispatchId } : {}),
        ...(t.assignee ? { assignee: t.assignee } : {}),
      });
    }
    for (const g of gl.value) {
      gates.push({
        id: g.id,
        taskId: g.taskId ?? "",
        open: isOpenGate(g),
        ...(g.question ? { question: g.question } : {}),
        // The first option is the recommendation (the 추천 column); a blank one is no recommendation.
        ...(g.options?.[0]?.trim() ? { options: g.options } : {}),
      });
    }
  }
  return done({ tasks, gates });
}

export interface LoadOptions {
  /** A JSONL event file replayed in memory instead of the store (fixtures, `--events`). */
  readonly eventsFile?: string;
  /** A snapshot JSON file instead of asking Orca (`--orca`). */
  readonly orcaFile?: string;
  readonly runs?: readonly string[];
  readonly now: string;
  readonly orca?: OrcaAdapter;
}

/** The brief's whole input: events (store or file) plus one Orca snapshot (adapter or file). Writes nothing. */
export async function loadBriefInput(o: LoadOptions): Promise<Result<BriefInput>> {
  let events: StoredEvent[];
  if (o.eventsFile) events = replayJsonl(readFileSync(o.eventsFile, "utf8"));
  // Store.open creates the database; a read with no database yet has no events.
  else if (!existsSync(defaultDbPath())) events = [];
  else {
    const store = Store.open();
    try {
      events = store.events();
    } finally {
      store.close();
    }
  }
  if (o.orcaFile) return done({ events, orca: JSON.parse(readFileSync(o.orcaFile, "utf8")) as BriefSnapshot, now: o.now });
  const orca = o.orca ?? createOrcaAdapter(nodeExec());
  const current = await orca.runCurrent();
  const runs = briefRuns(events, current.ok ? current.value.runId : null, o.runs);
  const snap = await readSnapshot(orca, runs);
  return snap.ok ? done({ events, orca: snap.value, now: o.now }) : snap;
}
