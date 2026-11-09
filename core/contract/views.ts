// View signatures (split §2 U1 (5), (9)). Every view is a pure function of one ViewInput: Orca rows
// read at call time plus events, with `now` injected. Nothing a view returns is written back to
// sqlite (no <view>_cache table, decision 76 rule 7). Views never call a clock, Orca or the network.

import type { Needs } from "./define.ts";
import type { ItemState } from "./transitions.ts";

export interface StoredEvent<P = Record<string, unknown>> {
  readonly seq: number;
  readonly ts: string;
  readonly type: string;
  readonly source: string;
  readonly target: string | null;
  readonly subject: string | null;
  readonly entity: string | null;
  readonly entity_id: string | null;
  readonly actor: string | null;
  readonly needs: Needs;
  readonly severity: string | null;
  readonly dedupe_key: string | null;
  /** The row's own format version as written; payload is already upcast to the current one. */
  readonly schema_v: number;
  readonly before: unknown;
  readonly payload: P;
}

// The fields views read from Orca. U2's row types in contract/orca.ts are wider; they only need to
// be assignable to these. The adapter has already dropped rows whose hostId is not "local" (decision 88).
export type ViewTaskStatus = "pending" | "ready" | "dispatched" | "blocked" | "completed" | "failed";

export interface ViewTask {
  readonly id: string;
  readonly runId: string;
  readonly status: ViewTaskStatus;
  /** Separates cancelled from failed when status is "failed". */
  readonly result?: string;
  readonly deps: readonly string[];
  readonly activeDispatchId?: string;
}

export interface ViewGate {
  readonly id: string;
  readonly taskId: string;
  readonly open: boolean;
}

export interface OrcaSnapshot {
  readonly tasks: readonly ViewTask[];
  readonly gates: readonly ViewGate[];
}

export interface ViewInput {
  readonly orca: OrcaSnapshot;
  readonly events: readonly StoredEvent[];
  readonly now: string;
}

export type WaitsOn = "owner" | "reviewer" | "infra" | "lead" | "worker";

export interface ItemStatusRow {
  readonly task: string;
  readonly alias: string | null;
  readonly state: ItemState | "unknown";
  readonly waitsOn: WaitsOn | null;
  readonly since: string | null;
  /** 🙋 open decision on the item. */
  readonly decisionOpen: boolean;
  /** 🚨 unresolved alarm event types (worker_stuck, worker_dead, ci_failed, ..., orphan_extra). */
  readonly alarms: readonly string[];
  /** ⚠️ unresolved trigger_unclear. */
  readonly unclear: boolean;
  /** 🔍 closed done without enough evidence. */
  readonly evidenceShort: boolean;
}

export interface OwnerTodoRow {
  readonly kind: "decision" | "owner_item" | "waiting_human" | "undelivered_answer";
  readonly ref: string;
  readonly whyOwner: string | null;
  readonly since: string;
}

export interface DecisionRow {
  readonly decision: string;
  readonly decisionKey: string;
  readonly state: "open" | "answered" | "closed";
  readonly answer: string | null;
  readonly linkedBy: string | null;
  readonly closedReason: "answered" | "moot" | null;
  readonly waiters: readonly { readonly task: string; readonly gate: string | null }[];
  /** Answered but a waiter's gate is still open in Orca: the answer is not delivered yet. */
  readonly undelivered: boolean;
}

export interface ReadyRow {
  readonly task: string;
  readonly alias: string | null;
}

export interface GroupBriefRow {
  readonly lead: string;
  readonly items: number;
  readonly blocked: number;
  readonly priority: "P0" | "P1" | "P2" | "P3";
  readonly oldestBlockedSince: string | null;
  readonly done: number;
}

export interface TimelineRow {
  readonly seq: number;
  readonly ts: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface AskDueRow {
  readonly pr: string;
  readonly reviewer: string;
  readonly lastAskedAt: string;
}

export interface RestartDueRow {
  readonly session: string;
  readonly rule: "compactions" | "first_call_half" | "compaction_interval" | "token_ceiling";
}

// The four rules of design N1; defaults live in config. Inputs: compacted{trigger, pre_tokens} and
// turn_ended{context_tokens} rows per session.
export interface RestartRules {
  readonly maxAutoCompactions: number;
  /** First call after a compaction at or above this share of pre_tokens (0.5). */
  readonly firstCallShare: number;
  readonly minIntervalMinutes: number;
  readonly tokenCeiling: number;
}

export interface AskRules {
  readonly remindAfterMinutes: number;
}

// Owners of the bodies are named per line; U1 ships decision and item_timeline (core/store/views/).
export type ItemStatusView = (input: ViewInput) => readonly ItemStatusRow[]; // U9 (+U7 state)
export type OwnerTodoView = (input: ViewInput) => readonly OwnerTodoRow[]; // U14
export type DecisionView = (input: ViewInput) => readonly DecisionRow[]; // U1
export type ReadyView = (input: ViewInput) => readonly ReadyRow[]; // U7
export type GroupBriefView = (input: ViewInput) => readonly GroupBriefRow[]; // U9
export type GroupItemsView = (input: ViewInput, lead: string) => readonly ItemStatusRow[]; // U9
export type ItemTimelineView = (input: ViewInput, task: string) => readonly TimelineRow[]; // U1
export type AskDueView = (input: ViewInput, rules: AskRules) => readonly AskDueRow[]; // U8
export type RestartDueView = (input: ViewInput, rules: RestartRules) => readonly RestartDueRow[]; // U10

export interface Views {
  readonly item_status: ItemStatusView;
  readonly owner_todo: OwnerTodoView;
  readonly decision: DecisionView;
  readonly ready: ReadyView;
  readonly group_brief: GroupBriefView;
  readonly group_items: GroupItemsView;
  readonly item_timeline: ItemTimelineView;
  readonly ask_due: AskDueView;
  readonly restart_due: RestartDueView;
}
