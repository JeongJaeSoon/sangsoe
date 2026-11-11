// The copy of the facts only sangsoe owns (decisions 182-184). One append-only JSON-lines file beside
// the database, written on the store's own write path: no timer, no second process. Host facts are
// never copied here; after a loss the existing readers read them again from Orca and GitHub.
import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
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
  "pr_changes_requested",
  "pr_closed",
  "pr_merged",
  "pr_opened",
  "pr_ready_to_merge",
  "pr_reopened",
  "pr_review_requested",
  "rate_limited",
  "review_commented",
  "review_replied",
  "run_stalled",
  "verify_tier_set",
  "waiting_decision",
  "wake_unconfirmed",
  "worker_dead",
  "worker_stuck",
] as const satisfies readonly EventType[];

/** No reader can return these, so a lost database loses them unless they are copied. */
export const OWN_TYPES = [
  "advisor_used",
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
  "item_retired",
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
  "review_verdict",
  "session_started",
  "signal",
  "stage_recorded",
  "timer_stalled",
  "todo_due",
  "trigger_unclear",
  "turn_ended",
  "unit_started",
  "unmapped_reviewer",
  "waiting_human",
  "waiting_released",
  "worker_done",
  "worker_idle",
] as const satisfies readonly EventType[];

/** The two readers' sources. Another writer of a host type (a hook, `start`, an owner probe) has no reader to re-emit its row. */
export const HOST_SOURCES = ["orca-monitor", "pr-monitor"] as const;

const HOST = new Set<string>(HOST_TYPES);
const HOST_SOURCE = new Set<string>(HOST_SOURCES);
/** A row is a host row only when a reader wrote a type the readers re-emit; every other row is copied. */
export const isOwnRow = (type: string, source: string): boolean => !(HOST.has(type) && HOST_SOURCE.has(source));

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
export type Line = { row: Row } | { counter: string; last: number };

export function appendLines(path: string, lines: readonly Line[]): void {
  if (lines.length === 0) return;
  appendFileSync(path, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}

/** SQL for "an own row" over the event table, the same rule as isOwnRow. */
export const OWN_ROW_SQL = `NOT (type IN (${HOST_TYPES.map((t) => `'${t}'`).join(", ")}) AND source IN (${HOST_SOURCES.map((s) => `'${s}'`).join(", ")}))`;

const TAIL_SPAN = 64 * 1024;

/**
 * The seq of the file's last row line, read from its end; 0 when it holds none, undefined when there
 * is no file. Every store appends under the write lock, so row lines run in seq order.
 */
export function lastRowSeq(path: string): number | undefined {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return undefined;
    throw e;
  }
  try {
    const size = fstatSync(fd).size;
    for (let span = TAIL_SPAN; ; span *= 4) {
      const start = Math.max(0, size - span);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString("utf8").split("\n");
      // The first piece of a window that starts mid-file may be a cut line.
      if (start > 0) lines.shift();
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const seq = (JSON.parse(lines[i] ?? "") as { row?: Row }).row?.seq;
          if (Number.isInteger(seq)) return Number(seq);
        } catch {
          // a torn line
        }
      }
      if (start === 0) return 0;
    }
  } finally {
    closeSync(fd);
  }
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
  const replaced: number[] = [];
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
        const prev = bySeq.get(seq);
        // A different row under the same seq is a line whose transaction rolled back after it was written.
        if (prev && JSON.stringify(prev) !== JSON.stringify(line.row)) replaced.push(seq);
        bySeq.set(seq, line.row);
      } else if (typeof line.counter === "string" && Number.isInteger(line.last)) {
        out.counters.set(line.counter, Math.max(out.counters.get(line.counter) ?? 0, Number(line.last)));
      } else out.skipped.push(`backup line ${i + 1}: neither an event row nor a number`);
    });
  if (replaced.length > 0) out.skipped.push(`backup: ${replaced.length} seq(s) held two different rows, the later kept (first ${replaced[0]})`);
  out.rows = [...bySeq.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
  return out;
}
