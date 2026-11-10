import type { OrcaSnapshot, ViewGate, ViewInput, ViewTask } from "../contract/index.ts";
import type { Edge, GraphRead } from "./graph.ts";

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
  /** Full text; the renderer cuts it to the column width, the panel may show it whole. */
  readonly text: string;
  readonly link?: string;
  /** Kept whole after a cut `text` (a lead row's " P0"). */
  readonly tail?: string;
  readonly strong?: boolean;
}

/** One table row; `id` is the dNNN, iNNN, lead:<name> or act:<seq> the rendered row shows. */
export interface Row {
  readonly id: string;
  readonly cells: readonly Cell[];
  /** The row is about a dangling predecessor (decision 26): the panel draws it in the danger tone. */
  readonly broken?: boolean;
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
 * in 진행 중 for `showHours`. Dropping it once linked waits for a `ref` on decision_answered (decision
 * 91⑤); U14 builds on this shape.
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
  /** ✅ closed in the last `doneDays`, newest first: summary.done rows (decision 199). */
  readonly done: Table;
}

export interface GraphEdgeRow {
  readonly pred: string;
  readonly succ: string;
  readonly kind: string;
  /** Null when `pred` is not an item (a PR, a decision, a Task Orca does not list): a reference. */
  readonly met: boolean | null;
}

/** One item box of the group's DAG; a predecessor that is not an item has none (decision 199). */
export interface GraphNodeRow {
  readonly id: string;
  readonly title: string;
  /** The state marker (🔄, 🚧, ...). */
  readonly state: string;
  /** The marker with its word (🔄 진행 중): what a table cell shows for this item's state. */
  readonly stateLabel: string;
  /** 🙋 🚨 as the brief prints them, "" when none. */
  readonly flags: string;
  /** The other group's name when the item is not this group's, else null. */
  readonly outside: string | null;
}

/** The group's summary tiles; doing + blocked + left is `items` (decision 199). */
export interface GroupFigures {
  readonly done: number;
  readonly doneDays: number;
  readonly doing: number;
  readonly blocked: number;
  readonly left: number;
  readonly planned: number;
  readonly ready: number;
  readonly onHold: number;
  /** Items with an open or undelivered decision (🙋). */
  readonly owner: number;
  /** Items with a standing alarm (🚨). */
  readonly flags: number;
}

/** GRAPH's why row as stage 2 reads it: the edge with ready.ts's 선행 상태 and 해야 할 일. */
export interface WhyEdge extends Edge {
  readonly predState: string;
  readonly dangling: boolean;
  readonly todo: string;
}

/** The read port stage 2 takes; graphRead (core/graph/read.ts) is the body. */
export interface GroupGraph extends GraphRead {
  why(input: ViewInput, task: string): readonly WhyEdge[];
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
  readonly figures: GroupFigures;
  /** Every item an edge touches, this group's and others'. */
  readonly nodes: readonly GraphNodeRow[];
  /** `pred>succ:kind` of the edges whose predecessor is dangling. */
  readonly brokenEdges: readonly string[];
  /** 단계 · 항목 · 상태 · 단계 이름, in path order. */
  readonly critical: Table;
  readonly stack: Table;
  /** One table per flow expanded under this group (ship-batch and the like). */
  readonly release: readonly Table[];
  readonly broken: Table;
  readonly edgeList: Table;
  /** The group's latest item transitions, newest first. */
  readonly recent: Table;
  readonly done: Table;
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
