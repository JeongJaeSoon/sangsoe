// The copy of the facts only sangsoe owns (decisions 182-184). One append-only JSON-lines file beside
// the database, written on the store's own write path: no timer, no second process. Host facts are
// never copied here; after a loss the existing readers read them again from Orca and GitHub.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { EventType, StoredEvent } from "../contract/index.ts";

/**
 * Rows the orca and pr readers write again from current host state (core/detect/orca/judge.ts,
 * core/detect/pr/round.ts). Every other event type is sangsoe's own and is copied.
 */
export const HOST_TYPES = [
  "ci_failed",
  "close_suggested",
  "decision_untracked",
  "main_green",
  "main_red",
  "owner_act_unlinked",
  "pr_base_changed",
  "pr_closed",
  "pr_merged",
  "pr_opened",
  "pr_ready_to_merge",
  "rate_limited",
  "run_stalled",
  "verify_tier_set",
  "waiting_decision",
  "wake_unconfirmed",
  "worker_dead",
  "worker_stuck",
] as const satisfies readonly EventType[];

/** No reader can return these, so a lost database loses them unless they are copied. */
export const OWN_TYPES = [
  "capacity_free",
  "compacted",
  "decision_answered",
  "decision_closed",
  "decision_joined",
  "decision_opened",
  "edge_added",
  "edge_removed",
  "escalation",
  "escalation_stale",
  "evidence",
  "flow_expanded",
  "flow_step_skipped",
  "gate_denied",
  "item_created",
  "item_extra_set",
  "item_ready",
  "item_transition",
  "job_drift",
  "land_failed",
  "land_requested",
  "loop_detected",
  "mention_new",
  "model_changed",
  "notified",
  "observed_change",
  "owner_action",
  "owner_class",
  "owner_text_redacted",
  "plugin_approved",
  "pr_changes_requested",
  "pr_review_requested",
  "pressure_high",
  "priority_set",
  "reap_blocked",
  "reap_candidate",
  "reap_done",
  "reap_round",
  "refusal_report",
  "resource",
  "resource_adopted",
  "resource_leak",
  "review_ask_sent",
  "review_commented",
  "review_replied",
  "review_verdict",
  "session_started",
  "signal",
  "stage_recorded",
  "timer_stalled",
  "todo_due",
  "trigger_unclear",
  "turn_ended",
  "unmapped_reviewer",
  "waiting_human",
  "waiting_released",
  "worker_done",
  "worker_idle",
] as const satisfies readonly EventType[];

const OWN = new Set<string>(OWN_TYPES);
export const isOwnType = (type: string): boolean => OWN.has(type);

export type Row = Record<string, string | number | null>;

/** A `signal{store_rebuilt}` with no `signal{host_rows_reread}` after it: the host rows are not read again yet. */
export function hostRereadPending(signals: readonly StoredEvent[]): boolean {
  const last = signals.findLast((e) => e.payload.kind === "store_rebuilt" || e.payload.kind === "host_rows_reread");
  return last?.payload.kind === "store_rebuilt";
}

export function backupPath(dbPath: string): string {
  return `${dbPath}.facts.jsonl`;
}

/** One line per own event row (every column, owner text excluded) or per issued number. */
type Line = { row: Row } | { counter: string; last: number };

export function appendLines(path: string, lines: readonly Line[]): void {
  if (lines.length === 0) return;
  appendFileSync(path, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}

export type BackupRead = {
  /** Sorted by seq; a seq written twice keeps its later line. */
  rows: Row[];
  counters: Map<string, number>;
  /** What the file held but restore cannot use, by name. */
  skipped: string[];
};

export function readBackup(path: string): BackupRead {
  const out: BackupRead = { rows: [], counters: new Map(), skipped: [] };
  if (!existsSync(path)) return out;
  const bySeq = new Map<number, Row>();
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((text, i) => {
      if (text === "") return;
      let line: Partial<{ row: Row; counter: string; last: number }>;
      try {
        line = JSON.parse(text) as typeof line;
      } catch {
        out.skipped.push(`backup line ${i + 1}: not JSON (a torn write)`);
        return;
      }
      if (line.row && Number.isInteger(line.row.seq) && typeof line.row.type === "string") {
        const seq = Number(line.row.seq);
        if (bySeq.has(seq)) out.skipped.push(`backup seq ${seq}: written twice, the later line kept`);
        bySeq.set(seq, line.row);
      } else if (typeof line.counter === "string" && Number.isInteger(line.last)) {
        out.counters.set(line.counter, Math.max(out.counters.get(line.counter) ?? 0, Number(line.last)));
      } else out.skipped.push(`backup line ${i + 1}: neither an event row nor a number`);
    });
  out.rows = [...bySeq.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
  return out;
}
