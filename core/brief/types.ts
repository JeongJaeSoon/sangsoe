import type { OrcaSnapshot, ViewGate, ViewInput, ViewTask } from "../contract/index.ts";

// Orca owns titles, assignees and gate text (ORCA_OWNED_KEYS); the brief reads them from the same
// snapshot it reads statuses from and stores none of them.
export type BriefTask = ViewTask & { readonly title?: string; readonly assignee?: string };
export type BriefGate = ViewGate & { readonly question?: string; readonly options?: readonly string[] };
export interface BriefSnapshot extends OrcaSnapshot {
  readonly tasks: readonly BriefTask[];
  readonly gates: readonly BriefGate[];
}
export interface BriefInput extends ViewInput {
  readonly orca: BriefSnapshot;
}

export interface Cell {
  readonly text: string;
  readonly link?: string;
}

/** One table row; `id` is the dNNN, iNNN, lead:<name> or act:<seq> the rendered row shows. */
export interface Row {
  readonly id: string;
  readonly cells: readonly Cell[];
}

export interface Column {
  readonly name: string;
  /** Maximum display cells (decision 89). */
  readonly max: number;
}

export interface Table {
  readonly title: string;
  /** Rows that are not lead rows: the N in the title. */
  readonly count: number;
  readonly columns: readonly Column[];
  readonly rows: readonly Row[];
}

export interface Summary {
  readonly done: number;
  readonly doing: number;
  readonly left: number;
  readonly blocked: number;
}

/**
 * Golden (8)'s input: an owner act that answered nothing (owner_act_unlinked), shown as one PR row
 * in 진행 중 for `showHours` unless a decision_answered{ref} linked it. U14 builds on this shape.
 */
export interface UnlinkedAct {
  readonly id: string;
  readonly seq: number;
  readonly act: string;
  readonly pr: string | null;
  readonly since: string;
}

export interface Overview {
  readonly stage: 1;
  readonly now: string;
  readonly groups: number;
  readonly todo: { readonly total: number; readonly decisions: number; readonly other: number };
  readonly summary: Summary;
  readonly decisions: Table;
  readonly ownerTodo: Table;
  readonly inProgress: Table;
  /** Null when nothing is on hold: the section is not drawn. */
  readonly onHold: Table | null;
  readonly doneDays: number;
  readonly evidenceShort: number;
}

export interface GraphEdgeRow {
  readonly pred: string;
  readonly succ: string;
  readonly kind: string;
  readonly met: boolean | null;
}

export interface GroupDetail {
  readonly stage: 2;
  readonly now: string;
  readonly lead: string;
  readonly priority: string;
  readonly items: number;
  readonly blockedCount: number;
  /** 🚧 · 🔄 · 대기열(🟢 📅 ⏸️) in that order; empty ones are left out. */
  readonly sections: readonly Table[];
  readonly doneFolded: number;
  readonly edges: readonly GraphEdgeRow[];
  /** Item labels, first is what slows the group now. */
  readonly criticalPath: readonly string[];
  readonly why: Table;
}

export interface ItemDetail {
  readonly stage: 3;
  readonly now: string;
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly flags: string;
  readonly who: string;
  readonly priority: string;
  readonly chain: Table;
}

export type BriefModel = Overview | GroupDetail | ItemDetail;

export interface BriefOptions {
  /** brief.done_days (default 7). */
  readonly doneDays?: number;
  /** unlinked.show_hours (default 24). */
  readonly showHours?: number;
}

export type { ViewInput };
