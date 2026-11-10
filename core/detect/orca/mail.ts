import { realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { dedupeKey, eventDef, type StoredEvent } from "../../contract/index.ts";
import type { InboxMessage, WorkerRow, WorktreePsRow } from "../../contract/orca.ts";
import { mask, summarize } from "../../session/mask.ts";
import type { Planned } from "../monitor.ts";

const SOURCE = "orca-monitor";

/** The first lines of a refusal file, or null when it is missing, unreadable or outside the roots. */
export type ReadRefusal = (path: string) => Promise<string | null>;

export type MailReads = {
  inbox: InboxMessage[];
  /** Every Dispatch this round's worker lists show, finished ones included. */
  known: ReadonlyMap<string, WorkerRow>;
  /** Dispatches not yet settled. */
  unfinished: ReadonlySet<string>;
  /** null when `worktree ps` failed. */
  ps: ReadonlyMap<string, WorktreePsRow> | null;
  events: readonly StoredEvent[];
  /** Header lines of each refusal file the mail points to, by path; a path absent here was not read. */
  refusals: ReadonlyMap<string, string | null>;
};

const key = (type: Parameters<typeof eventDef>[0], target: string, ...cond: string[]) => {
  const def = eventDef(type);
  if (!def) throw new Error(`no event type ${type}`);
  return dedupeKey(def, target, ...cond);
};

// Claude Code's own words when a turn ends on the plan's usage limit (recorded in the stop mail's
// last output). Orca sends that stop as `errored`, but the session resumes by itself.
const USAGE_LIMIT = /hit your [\w -]*limit|Usage limit reached/i;

// Sessions write the refusal file under <TMPDIR>/orch-refusal/ (or /tmp when TMPDIR is unset); a
// body's path is trusted only inside those roots. Bodies end the path with a sentence's period.
const REFUSAL_PATH = /(\/[^\s`'"()<>]*\/orch-refusal\/[^\s`'"()<>]+)/;
const trailing = (p: string) => p.replace(/[.,;:]+$/, "");

/** The refusal file a session's escalation names, if any. Orca's own stop mail never carries one. */
export function refusalPath(m: InboxMessage): string | undefined {
  if (m.type !== "escalation" || m.payload?.stopReason) return undefined;
  const hit = REFUSAL_PATH.exec(m.body ?? "")?.[1];
  return hit ? trailing(hit) : undefined;
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
};

export const REFUSAL_ROOTS = () => [...new Set([tmpdir(), "/tmp"].map((r) => real(join(r, "orch-refusal"))).filter((r) => r !== undefined))];

const HEAD_BYTES = 4096;

/** Reads the first 4 KiB of a refusal file whose real path lies under one of `roots`. */
export const readRefusalHead =
  (roots: readonly string[] = REFUSAL_ROOTS()): ReadRefusal =>
  async (path) => {
    const p = real(path);
    if (!p || !roots.some((r) => p.startsWith(r + sep))) return null;
    try {
      const f = await open(p, "r");
      try {
        const buf = Buffer.alloc(HEAD_BYTES);
        const { bytesRead } = await f.read(buf, 0, HEAD_BYTES, 0);
        return buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        await f.close();
      }
    } catch {
      return null;
    }
  };

/** Decision 196: a line that starts with `Act:` and one that starts with `Category:`, in the first 20 lines. */
export function refusalHeader(head: string): { act: string; category: string } | undefined {
  const lines = head.split("\n").slice(0, 20);
  const field = (name: string) => {
    const re = new RegExp(`^\\s*${name}:\\s*(\\S.*)$`, "i");
    for (const l of lines) {
      const v = re.exec(l)?.[1];
      if (v) return summarize(mask(v), 200);
    }
    return undefined;
  };
  const act = field("Act");
  const category = field("Category");
  return act && category ? { act, category } : undefined;
}

const waiting = (row: WorktreePsRow | undefined) => (row?.agents ?? []).some((a) => a.agentWait !== null && a.agentWait !== undefined);

/**
 * Orca's mail, read from the same `inbox` page the wake check reads (decision 196). Orca already
 * delivers each message to the coordinator; these rows only put it on the brief. A stop mail counts
 * only while its Dispatch is unfinished, so old mail does not raise alarms.
 */
export function judgeMail(r: MailReads, planned: Planned[], unseen: string[]): void {
  const recorded = new Set(r.events.map((e) => e.dedupe_key).filter((k) => k !== null));
  const plan = (e: Planned) => {
    if (e.dedupe_key && recorded.has(e.dedupe_key)) return;
    recorded.add(e.dedupe_key ?? "");
    planned.push(e);
  };
  for (const m of r.inbox) {
    const dispatch = m.payload?.dispatchId;
    const w = dispatch ? r.known.get(dispatch) : undefined;
    if (!dispatch || !w) continue;
    const task = m.payload?.taskId ?? w.taskId;
    const on = { entity: "dispatch", entity_id: dispatch, target: task } as const;

    if (m.type === "worker_done") {
      plan({ type: "worker_done", source: SOURCE, payload: { dispatch, task, msg_id: m.id }, ...on, dedupe_key: key("worker_done", dispatch, m.id) });
      continue;
    }
    const stop = m.payload?.stopReason;
    if (stop && r.unfinished.has(dispatch)) {
      if (stop === "errored" && USAGE_LIMIT.test(m.body ?? "")) {
        plan({ type: "rate_limited", source: SOURCE, payload: { kind: "usage_limit" }, ...on, dedupe_key: key("rate_limited", dispatch, m.id) });
      } else if (stop === "errored") {
        plan({ type: "worker_dead", source: SOURCE, payload: { reason: "stop_failure" }, ...on, dedupe_key: key("worker_dead", dispatch, m.id) });
      } else if (stop === "needs-input") {
        if (!r.ps) continue;
        // Written only while ps still shows the wait, so a prompt answered before this round is no row.
        if (!waiting(w.workspace ? r.ps.get(w.workspace) : undefined)) continue;
        plan({
          type: "waiting_human",
          source: SOURCE,
          payload: { dispatch },
          entity: "task",
          entity_id: task,
          dedupe_key: key("waiting_human", dispatch, m.id),
        });
      }
      // `finished` is a turn the worker ended on purpose (waiting on an answer): no row.
      continue;
    }
    const path = refusalPath(m);
    if (!path) continue;
    const k = key("refusal_report", dispatch, m.id);
    if (recorded.has(k)) continue;
    const head = r.refusals.get(path);
    if (head === undefined) continue;
    const h = head === null ? undefined : refusalHeader(head);
    if (!h) {
      unseen.push(`refusal file of ${m.id}: ${head === null ? "not readable" : "no Act:/Category: header"}`);
      continue;
    }
    plan({ type: "refusal_report", source: SOURCE, payload: { ...h, command_file: path }, ...on, dedupe_key: k });
  }
  releaseDispatchWaits(r, plan);
}

/**
 * A wait Orca's mail opened is released by Orca's state, not by a hook (a dispatched session may run
 * with the plugin off): ps showing no wait on the workspace answers it; a settled Dispatch makes it moot.
 */
function releaseDispatchWaits(r: MailReads, plan: (e: Planned) => void): void {
  if (!r.ps) return;
  const released = new Set(r.events.filter((e) => e.type === "waiting_released").map((e) => String(e.payload.ref)));
  for (const w of r.events) {
    if (w.type !== "waiting_human" || released.has(String(w.seq))) continue;
    const dispatch = w.payload.dispatch;
    if (typeof dispatch !== "string") continue;
    const row = r.known.get(dispatch);
    if (!row) continue;
    const settled = !r.unfinished.has(dispatch);
    if (!settled && waiting(row.workspace ? r.ps.get(row.workspace) : undefined)) continue;
    if (!settled && !(row.workspace && r.ps.has(row.workspace))) continue;
    plan({
      type: "waiting_released",
      source: SOURCE,
      payload: { ref: String(w.seq), outcome: settled ? "moot" : "answered", by: "unknown", evidence: settled ? "dispatch_settled" : "agent_wait_gone" },
      ...(w.entity ? { entity: w.entity } : {}),
      ...(w.entity_id ? { entity_id: w.entity_id } : {}),
      dedupe_key: key("waiting_released", String(w.seq)),
    });
  }
}
