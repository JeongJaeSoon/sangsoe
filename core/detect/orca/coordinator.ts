import { dedupeKey, EVENTS } from "../../contract/index.ts";
import type { InboxMessage, LocalRows, WorktreePsRow } from "../../contract/orca.ts";
import { type MonitorConfig, minutes, type Planned } from "../monitor.ts";

const SOURCE = "orca-monitor";

/** The inbox page the round reads: the newest messages across every recipient. */
export const INBOX_PAGE = 100;

/** What the round read about one Run's coordinator, from Orca alone. */
export type CoordinatorRead = {
  /** The `worktree ps` paneKey of its live terminal; absent when no live terminal was found. */
  pane?: string;
  handle?: string;
  /** Whether a Dispatch's worker runs in that terminal; absent when the worker list was not read in full. */
  dispatch?: boolean;
  /** The Run may have a live coordinator the round could not place: run-show failed, or its live terminal has no ps pane. */
  unresolved?: true;
};

const at = (iso: string | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Per Run, the newest message to `run:<id>` still unread at least N minutes after Orca made it: an
 * older one from before the coordinator's last turn must not hide one that came after it.
 */
export function oldUnread(inbox: readonly InboxMessage[], now: number, c: MonitorConfig): Map<string, InboxMessage> {
  const out = new Map<string, InboxMessage>();
  for (const m of inbox) {
    const sent = at(m.createdAt);
    if (m.handled || !m.to.startsWith("run:") || Number.isNaN(sent) || now - sent < minutes(c.stuckMinutes)) continue;
    const run = m.to.slice("run:".length);
    const before = out.get(run);
    if (!before || sent > at(before.createdAt)) out.set(run, m);
  }
  return out;
}

/** Every Run the page names: a recipient `run:<id>` or the message's own Run. */
export function namedRuns(inbox: readonly InboxMessage[]): string[] {
  const runs = inbox.flatMap((m) => [...(m.to.startsWith("run:") ? [m.to.slice("run:".length)] : []), ...(m.runId ? [m.runId] : [])]);
  return [...new Set(runs)];
}

/**
 * The Run's coordinator as its own mail shows it: the terminal and pane of the newest message of
 * that Run a terminal sent to one of the Run's Dispatches. Used when `run-show`'s coordinator
 * handle is no live terminal (measured 2026-11-14: a coordinator that resumed in a new terminal
 * keeps the old handle there, and a background terminal's list row names no ps pane).
 */
export function fromMail(inbox: readonly InboxMessage[], run: string): { pane: string; handle: string } | undefined {
  const own = inbox.filter((m) => m.runId === run && m.from.startsWith("term_") && m.to.startsWith("dispatch:") && m.senderPane);
  const m = own.sort((a, b) => at(b.createdAt) - at(a.createdAt))[0];
  return m?.senderPane ? { pane: m.senderPane, handle: m.from } : undefined;
}

/** The live coordinators holding no Dispatch: the tops of the Run tree. */
const tops = (coords: ReadonlyMap<string, CoordinatorRead>) => [...coords].filter(([, k]) => k.pane && k.dispatch === false).map(([run]) => run);

/**
 * Who hears of a stall of `run`: the one other top Run (the orchestrator's), or `run` itself when it
 * is the only top (a stalled orchestrator). Anything else is no one: the row stands alone.
 */
export function recipientOf(run: string, coords: ReadonlyMap<string, CoordinatorRead>): string | undefined {
  if ([...coords.values()].some((k) => k.unresolved || (k.pane && k.dispatch === undefined))) return undefined;
  const all = tops(coords);
  const others = all.filter((r) => r !== run);
  if (others.length === 1) return others[0];
  return others.length === 0 && all.includes(run) ? run : undefined;
}

/**
 * Decision 245: a Run whose coordinator holds no Dispatch is stalled when Orca shows mail to that
 * Run unread N minutes after it arrived, and the coordinator's agent in `worktree ps` has not
 * worked since before that mail (not working, no wait, state started before the mail). One row
 * per stall: the key names the agent's state start, so its next turn re-arms it. Orca's fields
 * only: no screen text (decision 87), no store rows.
 */
export function judgeCoordinators(
  inbox: readonly InboxMessage[] | null,
  coords: ReadonlyMap<string, CoordinatorRead>,
  ps: LocalRows<WorktreePsRow> | null,
  now: number,
  c: MonitorConfig,
  planned: Planned[],
  unseen: string[],
): void {
  if (!inbox) return;
  const n = minutes(c.stuckMinutes);
  const oldest = Math.min(...inbox.map((m) => at(m.createdAt)).filter((t) => !Number.isNaN(t)));
  if (inbox.length >= INBOX_PAGE && oldest > now - n) {
    unseen.push(`coordinator mail: the inbox page reaches back less than ${c.stuckMinutes} minutes`);
  }
  const agents = new Map((ps?.rows ?? []).flatMap((row) => (row.agents ?? []).map((a) => [a.paneKey, a] as const)));
  for (const [run, mail] of oldUnread(inbox, now, c)) {
    const k = coords.get(run);
    if (!k?.pane || !k.handle) {
      unseen.push(`coordinator of run:${run}: no live terminal`);
      continue;
    }
    if (k.dispatch === undefined) {
      unseen.push(`coordinator of run:${run}: worker list not read in full`);
      continue;
    }
    if (k.dispatch) continue;
    const agent = ps ? agents.get(k.pane) : undefined;
    if (!agent) {
      unseen.push(`coordinator of run:${run}: no ps agent row`);
      continue;
    }
    if (agent.state === "working" || (agent.agentWait !== null && agent.agentWait !== undefined)) continue;
    const since = agent.stateStartedAt;
    if (!isTime(since) || since > now) {
      unseen.push(`coordinator of run:${run}: no state time`);
      continue;
    }
    if (at(mail.createdAt) <= since) continue;
    planned.push({
      type: "run_stalled",
      source: SOURCE,
      payload: { run, coordinator: k.handle },
      dedupe_key: dedupeKey(EVENTS.run_stalled, run, "coordinator", k.pane, String(since)),
    });
  }
}
