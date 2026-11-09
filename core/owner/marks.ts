import type { StoredEvent, VerifySpec, ViewInput } from "../contract/index.ts";
import type { OwnerConfig } from "./types.ts";

/**
 * A flag on an owner item, never a state (glossary "플래그는 상태가 아니다"):
 * - verifying: `입력 확인됨 · 검증 중`, a linked `!` line with a verify to read (rows 5, 8)
 * - no_verify: the same line on an item without verify, "검증 안 됨" until the panel button (row 6)
 * - failed: `실행 실패`, the linked line exited non-zero or wrote stderr (row 7)
 * - unverified: `검증 안 됨`, verifying for longer than verify.wait_minutes with no probe true (row 11)
 */
export type OwnerMark = "verifying" | "no_verify" | "failed" | "unverified";

export const MARK_LABEL: Readonly<Record<OwnerMark, string>> = {
  verifying: "입력 확인됨 · 검증 중",
  no_verify: "검증 안 됨",
  failed: "실행 실패",
  unverified: "검증 안 됨",
};

/** The owner_class values that take a mark off (row 10); the orchestrator classifies, no word rule does. */
export const UNMARK_CLASSES: readonly string[] = ["not_yet", "cancel"];

export interface OwnerItemMarks {
  readonly task: string;
  readonly createdAt: string | null;
  readonly verify: VerifySpec | null;
  readonly cmdHint: string | null;
  readonly mark: OwnerMark | null;
  /** When the current mark went on: the owner_act:seen row's time. */
  readonly markedAt: string | null;
  readonly markedSeq: number | null;
  /** run_ok's run id, filled from the linked `!` line's stdout (row 8 replaces it). */
  readonly run: string | null;
  /** The probe:<verify.kind> evidence that made the verify true, if any. */
  readonly verified: { readonly seq: number; readonly ts: string; readonly observed: string } | null;
}

const RUN_URL = /\/actions\/runs\/(\d+)/;
export const runFrom = (observed: string | undefined): string | null => (observed ? (RUN_URL.exec(observed)?.[1] ?? null) : null);

const taskOf = (e: StoredEvent): string | null => (e.entity === "task" && e.entity_id ? e.entity_id : null);

/**
 * The evidence that lifts 🔍 on a closed item: a probe that observed the effect, or the panel
 * button on an item with no verify. An owner's `!` line (owner_act:*) is input, never evidence.
 */
export function countsAsEvidence(e: StoredEvent): boolean {
  if (e.type !== "evidence") return false;
  const kind = String(e.payload.kind);
  return kind.startsWith("probe:") || kind === DONE_EVIDENCE;
}
export const DONE_EVIDENCE = "owner_done";

/** Folds every item's verify, hint and mark from the events; pure, `now` decides row 11. */
export function ownerMarks(input: ViewInput, cfg: Pick<OwnerConfig, "waitMinutes">): Map<string, OwnerItemMarks> {
  type M = { -readonly [K in keyof OwnerItemMarks]: OwnerItemMarks[K] };
  const out = new Map<string, M>();
  const at = (task: string): M => {
    let m = out.get(task);
    if (!m) {
      m = { task, createdAt: null, verify: null, cmdHint: null, mark: null, markedAt: null, markedSeq: null, run: null, verified: null };
      out.set(task, m);
    }
    return m;
  };
  for (const e of input.events) {
    const p = e.payload;
    if (e.type === "item_created") at(String(p.task)).createdAt = e.ts;
    else if (e.type === "item_extra_set") {
      const m = at(String(p.task));
      if (p.verify !== undefined) m.verify = p.verify as VerifySpec;
      if (typeof p.cmd_hint === "string") m.cmdHint = p.cmd_hint;
    } else if (e.type === "evidence") {
      const task = taskOf(e);
      if (!task) continue;
      const m = at(task);
      const kind = String(p.kind);
      const observed = typeof p.observed === "string" ? p.observed : undefined;
      if (kind === "owner_act:seen") {
        m.mark = m.verify ? "verifying" : "no_verify";
        m.markedAt = e.ts;
        m.markedSeq = e.seq;
        m.run = runFrom(observed) ?? m.run;
      } else if (kind === "owner_act:failed" && m.mark === null) m.mark = "failed";
      else if (m.verify && kind === `probe:${m.verify.kind}` && m.verified === null && (m.createdAt === null || e.ts >= m.createdAt)) {
        m.verified = { seq: e.seq, ts: e.ts, observed: observed ?? "" };
      }
    } else if (e.type === "owner_class" && UNMARK_CLASSES.includes(String(p.class))) {
      const task = taskOf(e);
      if (!task) continue;
      const m = at(task);
      m.mark = null;
      m.markedAt = null;
      m.markedSeq = null;
      m.run = null;
    }
  }
  const limit = Date.parse(input.now) - cfg.waitMinutes * 60_000;
  for (const m of out.values()) {
    if (m.mark === "verifying" && m.verified === null && m.markedAt !== null && Date.parse(m.markedAt) <= limit) m.mark = "unverified";
  }
  return out;
}

/** run_ok's operands with the run the owner's line filled in. */
export function verifyWithRun(m: OwnerItemMarks): VerifySpec | null {
  if (!m.verify) return null;
  if (m.verify.kind === "run_ok" && m.run) return { ...m.verify, run: m.run };
  return m.verify;
}
