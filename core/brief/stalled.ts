import type { StoredEvent } from "../contract/index.ts";
import { since } from "./width.ts";

/** A coordinator stall older than this drops off unresolved: the detector writes once per stall, and a coordinator sangsoe does not record never shows a turn. */
export const STALL_SHOW_HOURS = 24;

const runOf = (col: string | null | undefined) => (col?.startsWith("run:") ? col.slice(4) : undefined);

/**
 * Decision 309: one 🚨 line per Run whose Dispatch-less coordinator orca-monitor saw stopped
 * (run_stalled with `coordinator`, decision 245) and that has not moved since. A later turn, owner
 * prompt or (re)start of an orchestrator or lead session holding that Run ends it; the held Run is
 * session_started's `target`, not `subject` (the Run a Task lives in). A worker run_stalled has no
 * coordinator and is not shown here.
 */
export function stalledCoordinatorLines(events: readonly StoredEvent[], now: string): string[] {
  const held = new Map<string, string>();
  const stalls = new Map<string, StoredEvent>();
  const moved = (run: string | undefined) => {
    if (run) stalls.delete(run);
  };
  for (const e of events) {
    const p = e.payload;
    if (e.type === "session_started") {
      // A worker coordinates nothing; its turns are what fill the stalled Run's mail.
      const run = p.role === "worker" ? undefined : runOf(e.target);
      if (run) held.set(String(p.session), run);
      else held.delete(String(p.session));
      moved(run);
    } else if (e.type === "turn_ended") moved(held.get(String(p.session)));
    else if (e.type === "owner_action" && typeof p.cc_session === "string") moved(held.get(p.cc_session));
    else if (e.type === "run_stalled" && typeof p.run === "string" && typeof p.coordinator === "string") stalls.set(p.run, e);
  }
  const from = Date.parse(now) - STALL_SHOW_HOURS * 3_600_000;
  return [...stalls.values()]
    .filter((e) => Date.parse(e.ts) >= from)
    .sort((a, b) => a.seq - b.seq)
    .map((e) => `🚨 코디네이터 멈춤 · run:${e.payload.run} · ${e.payload.coordinator} · ${since(e.ts, now)} 전 감지 · 그 터미널에 말을 걸어 Run 의 메일을 읽힌다`);
}
