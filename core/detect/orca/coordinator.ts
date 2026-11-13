import { dedupeKey, EVENTS, type StoredEvent } from "../../contract/index.ts";
import type { InboxMessage } from "../../contract/orca.ts";
import { toSessionRow } from "../../session/session.ts";
import { type MonitorConfig, minutes, type Planned } from "../monitor.ts";

const SOURCE = "orca-monitor";

/** The inbox page the round reads: the newest messages across every recipient. */
export const INBOX_PAGE = 100;

/** Store rows the coordinator judgment reads besides the Orca reads. */
export const COORDINATOR_EVENT_TYPES = ["session_started", "turn_ended"] as const;

type Coordinator = { session: string; started: StoredEvent };

/** Each Run's latest session_started row, by the Run it held at start. */
function latestByRun(events: readonly StoredEvent[]): Map<string, Coordinator> {
  const out = new Map<string, Coordinator>();
  for (const e of events) {
    if (e.type !== "session_started") continue;
    const run = toSessionRow(e).heldRun;
    if (run && typeof e.payload.session === "string") out.set(run, { session: e.payload.session, started: e });
  }
  return out;
}

/** The orchestrator's Run: the Run its latest session holding no Dispatch held at start. */
export function orchestratorRunOf(events: readonly StoredEvent[]): string | undefined {
  const rows = events.filter((e) => e.type === "session_started").map(toSessionRow);
  return rows.filter((r) => r.role === "orchestrator" && !r.task && r.heldRun).at(-1)?.heldRun;
}

const at = (iso: string | undefined) => (iso ? Date.parse(iso) : Number.NaN);

/**
 * Decision 245: a Run whose coordinator holds no Dispatch (the orchestrator, a Task-less lead) and
 * whose mail Orca still shows unread N minutes after it arrived, with no turn ended since, is
 * stalled. One row per stall: the key names the coordinator's last turn end, so its next turn
 * re-arms it. Facts read: Orca's read flag and created_at, the store's session_started and
 * turn_ended rows; never screen text (decision 87).
 */
export function judgeCoordinators(inbox: readonly InboxMessage[] | null, events: readonly StoredEvent[], now: number, c: MonitorConfig, planned: Planned[], unseen: string[]): void {
  if (!inbox) return;
  const n = minutes(c.stuckMinutes);
  const oldest = Math.min(...inbox.map((m) => at(m.createdAt)).filter((t) => !Number.isNaN(t)));
  if (inbox.length >= INBOX_PAGE && oldest > now - n) {
    unseen.push(`coordinator mail: the inbox page reaches back less than ${c.stuckMinutes} minutes`);
  }
  const coordinators = latestByRun(events);
  const lastTurn = new Map<string, StoredEvent>();
  for (const e of events) if (e.type === "turn_ended" && typeof e.payload.session === "string") lastTurn.set(e.payload.session, e);

  const stalled = new Set<string>();
  for (const m of inbox) {
    if (m.handled || !m.to.startsWith("run:")) continue;
    const run = m.to.slice("run:".length);
    const k = coordinators.get(run);
    const sent = at(m.createdAt);
    if (!k || stalled.has(run) || toSessionRow(k.started).task || Number.isNaN(sent) || now - sent < n) continue;
    const end = lastTurn.get(k.session) ?? k.started;
    if (sent <= Date.parse(end.ts)) continue;
    stalled.add(run);
    const episode = end.type === "turn_ended" ? `turn-${end.seq}` : `start-${end.seq}`;
    planned.push({
      type: "run_stalled",
      source: SOURCE,
      payload: { run, session: k.session },
      dedupe_key: dedupeKey(EVENTS.run_stalled, run, "coordinator", k.session, episode),
    });
  }
}
