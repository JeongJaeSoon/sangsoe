import { decisionKey } from "../decision/key.ts";
import { readDecisionByKey } from "../decision/waiters.ts";
import { edgeId, foldFacts } from "../graph/facts.ts";
import { itemRef } from "../graph/nodes.ts";
import type { Store } from "../store/store.ts";
import type { OldItem, OldItemStatus, OldState } from "./source.ts";

/** What sangsoe keeps of an old item besides the Orca Task (decision 140's table). */
export interface ImportExtra {
  hold?: true;
  exec_by?: "owner";
  trigger?: string;
  links: string[];
}

export interface PlannedItem {
  readonly id: string;
  readonly status: OldItemStatus;
  readonly action: "create" | "already";
  /** The Task an earlier import made, when action is already. */
  readonly task?: string;
  readonly create: { readonly title: string; readonly spec: string; readonly who: string; readonly doneWhen: string };
  readonly extra: ImportExtra;
}

export interface PlannedEdge {
  readonly pred: string;
  readonly succ: string;
  readonly kind: "after";
  readonly action: "create" | "already";
}

export interface PlannedDecision {
  readonly id: string;
  readonly action: "create" | "already";
  readonly subject: string;
  readonly options: readonly string[];
  /** Goes into the Orca gate only. */
  readonly question: string;
}

export interface ImportCounts {
  readonly items: { open: number; create: number; already: number } & Record<OldItemStatus, number>;
  readonly decisions: { open: number; create: number; already: number };
  readonly edges: { create: number; already: number };
  readonly skipped: OldState["skipped"];
}

export interface ImportPlan {
  readonly items: readonly PlannedItem[];
  readonly edges: readonly PlannedEdge[];
  readonly decisions: readonly PlannedDecision[];
  readonly counts: ImportCounts;
}

/** What earlier imports left in the sangsoe store. */
export interface Imported {
  readonly items: ReadonlyMap<string, string>;
  readonly edges: ReadonlySet<string>;
  readonly hasDecision: (key: string) => boolean;
}

const REQUEST = "request:agent-skills/item/";
export const DONE_WHEN = "옛 항목의 목표가 이뤄진다(처음 손댈 때 다시 적는다)";
export const decisionSubject = (id: string) => `scope:agent-skills-${id}`;

/** Reads the request-id links (the same idiom as expandFlow) and the decision keys an earlier import wrote. */
export function importedFrom(store: Store): Imported {
  const facts = foldFacts(store.events());
  const items = new Map<string, string>();
  for (const x of facts.items.values()) {
    for (const l of x.links ?? []) if (l.startsWith(REQUEST)) items.set(l.slice(REQUEST.length), x.task);
  }
  return {
    items,
    edges: new Set(facts.edges.map((e) => edgeId(e.pred, e.succ, e.kind))),
    // decisionOpen writes decision_opened before the carrier and its gate, so the row alone is not done.
    hasDecision: (key) => {
      const s = readDecisionByKey(store, key);
      return s !== undefined && (s.row.state !== "open" || s.waiters.some((w) => w.gate !== null));
    },
  };
}

export const NOTHING_IMPORTED: Imported = { items: new Map(), edges: new Set(), hasDecision: () => false };

function planItem(it: OldItem, edgeTo: boolean, imported: Imported): PlannedItem {
  const trigger = [it.trig, it.due ? `due ${it.due}` : null, it.afterRef && !edgeTo ? `after ${it.afterRef}` : null].filter(Boolean).join(" · ");
  const extra: ImportExtra = {
    ...(it.status === "held" ? { hold: true as const } : {}),
    ...(it.lane === "owner_todo" ? { exec_by: "owner" as const } : {}),
    ...(trigger ? { trigger } : {}),
    links: [`${REQUEST}${it.id}`, ...(it.program ? [`agent-skills-program:${it.program}`] : [])],
  };
  const task = imported.items.get(it.id);
  return {
    id: it.id,
    status: it.status,
    action: task ? "already" : "create",
    ...(task ? { task } : {}),
    create: {
      title: it.title,
      spec: [it.title, it.next, it.note, `agent-skills ${it.id} 에서 가져옴`].filter(Boolean).join("\n"),
      who: it.who ?? "owner",
      doneWhen: DONE_WHEN,
    },
    extra,
  };
}

/** Pure: old open records against what the store already holds. --dry-run shows this and nothing else. */
export function planImport(old: OldState, imported: Imported): ImportPlan {
  const open = new Set(old.items.map((i) => i.id));
  const linked = (it: OldItem) => it.afterRef !== null && it.afterRef !== it.id && open.has(it.afterRef);
  const items = old.items.map((it) => planItem(it, linked(it), imported));
  const edges = old.items.filter(linked).map((it): PlannedEdge => {
    const p = imported.items.get(it.afterRef as string);
    const s = imported.items.get(it.id);
    const known = p !== undefined && s !== undefined && imported.edges.has(edgeId(itemRef(p), itemRef(s), "after"));
    return { pred: it.afterRef as string, succ: it.id, kind: "after", action: known ? "already" : "create" };
  });
  const decisions = old.decisions.map((d): PlannedDecision => {
    const subject = decisionSubject(d.id);
    return {
      id: d.id,
      action: imported.hasDecision(decisionKey(subject, d.options)) ? "already" : "create",
      subject,
      options: d.options,
      question: [d.title, d.body, d.link].filter(Boolean).join("\n"),
    };
  });
  const n = <T extends { action: string }>(xs: readonly T[], a: string) => xs.filter((x) => x.action === a).length;
  const status = (st: OldItemStatus) => items.filter((i) => i.status === st).length;
  return {
    items,
    edges,
    decisions,
    counts: {
      items: { open: items.length, create: n(items, "create"), already: n(items, "already"), todo: status("todo"), doing: status("doing"), held: status("held") },
      decisions: { open: decisions.length, create: n(decisions, "create"), already: n(decisions, "already") },
      edges: { create: n(edges, "create"), already: n(edges, "already") },
      skipped: old.skipped,
    },
  };
}
