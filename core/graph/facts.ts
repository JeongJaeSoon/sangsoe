import type { StoredEvent } from "../contract/views.ts";
import { ownerVerify } from "../owner/pending.ts";

export type EdgeKind = "blocks" | "after" | "stacked_on" | "deploys_after";
export const EDGE_KINDS: readonly EdgeKind[] = ["blocks", "after", "stacked_on", "deploys_after"];
export type Stage = "merge" | "dev" | "prod";

export interface ExtraEdge {
  readonly pred: string;
  readonly succ: string;
  readonly kind: EdgeKind;
  readonly seq: number;
}

/** The latest of each item_extra_set field per Task, with the item_created binding. */
export interface ItemExtra {
  readonly task: string;
  alias?: string;
  who?: string;
  createdSeq?: number;
  execBy?: string;
  lead?: string;
  priority?: string;
  est?: string;
  trigger?: string;
  hold?: boolean;
  flow?: string;
  step?: string;
  stage?: Stage;
  whyOwner?: string;
  links?: readonly string[];
}

export interface PrFact {
  readonly pr: string;
  opened: boolean;
  merged: boolean;
  closed: boolean;
  /** Tasks the PR is attached to (pr_opened.task). */
  readonly tasks: Set<string>;
  /** Its head branch when the head lives in the PR's own repository (pr_opened.head). */
  head?: string;
  /** Its base branch as last seen: pr_opened.base, then each pr_base_changed.to. */
  base?: string;
}

export interface FlowRecord {
  readonly flow: string;
  readonly version: string;
  readonly parent: string;
  readonly steps: readonly string[];
}

export interface Facts {
  readonly edges: readonly ExtraEdge[];
  /** How many times each pred>succ:kind was removed; the next add's dedupe condition. */
  readonly removals: ReadonlyMap<string, number>;
  readonly items: ReadonlyMap<string, ItemExtra>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly prs: ReadonlyMap<string, PrFact>;
  readonly decisionsOpened: ReadonlySet<string>;
  readonly decisionsClosed: ReadonlySet<string>;
  readonly stages: readonly { readonly pr: string; readonly stage: Stage }[];
  readonly flows: readonly FlowRecord[];
  /** Skipped steps by `<root task>/<step id>`, with the reason. */
  readonly skipped: ReadonlyMap<string, string>;
  readonly ownerActions: ReadonlySet<number>;
  /** Owner items with a verify: when a probe saw it true, null while none has (decision 181). */
  readonly ownerVerify: ReadonlyMap<string, string | null>;
}

export const edgeId = (pred: string, succ: string, kind: string): string => `${pred}>${succ}:${kind}`;

const EXTRA_FIELDS: Readonly<Record<string, keyof ItemExtra>> = {
  exec_by: "execBy",
  lead: "lead",
  priority: "priority",
  est: "est",
  trigger: "trigger",
  hold: "hold",
  flow: "flow",
  step: "step",
  stage: "stage",
  why_owner: "whyOwner",
  links: "links",
};

/** Folds the event log once; every GRAPH function reads this, never the rows directly. */
export function foldFacts(events: readonly StoredEvent[]): Facts {
  const live = new Map<string, ExtraEdge>();
  const removals = new Map<string, number>();
  const items = new Map<string, ItemExtra>();
  const aliases = new Map<string, string>();
  const prs = new Map<string, PrFact>();
  const decisionsOpened = new Set<string>();
  const decisionsClosed = new Set<string>();
  const stages: { pr: string; stage: Stage }[] = [];
  const flows: FlowRecord[] = [];
  const skipped = new Map<string, string>();
  const ownerActions = new Set<number>();
  const item = (task: string) => {
    const x = items.get(task) ?? { task };
    items.set(task, x);
    return x;
  };
  const pr = (ref: string) => {
    const x = prs.get(ref) ?? { pr: ref, opened: false, merged: false, closed: false, tasks: new Set<string>() };
    prs.set(ref, x);
    return x;
  };

  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case "edge_added": {
        const id = edgeId(String(p.pred), String(p.succ), String(p.kind));
        live.set(id, { pred: String(p.pred), succ: String(p.succ), kind: p.kind as EdgeKind, seq: e.seq });
        break;
      }
      case "edge_removed": {
        const id = edgeId(String(p.pred), String(p.succ), String(p.kind));
        if (live.delete(id)) removals.set(id, (removals.get(id) ?? 0) + 1);
        break;
      }
      case "item_created": {
        const x = item(String(p.task));
        x.alias = String(p.alias);
        x.who = String(p.who);
        x.createdSeq = e.seq;
        aliases.set(String(p.alias), String(p.task));
        break;
      }
      case "item_extra_set": {
        const x = item(String(p.task)) as unknown as Record<string, unknown>;
        for (const [k, field] of Object.entries(EXTRA_FIELDS)) if (p[k] !== undefined) x[field] = p[k];
        break;
      }
      case "pr_opened": {
        const x = pr(String(p.pr));
        x.opened = true;
        if (typeof p.task === "string") x.tasks.add(p.task);
        if (typeof p.head === "string") x.head = p.head;
        if (typeof p.base === "string" && x.base === undefined) x.base = p.base;
        break;
      }
      case "pr_base_changed":
        pr(String(p.pr)).base = String(p.to);
        break;
      case "pr_merged":
        pr(String(p.pr)).merged = true;
        break;
      case "pr_closed":
        pr(String(p.pr)).closed = true;
        break;
      case "pr_reopened":
        pr(String(p.pr)).closed = false;
        break;
      case "decision_opened":
        decisionsOpened.add(String(p.decision));
        break;
      case "decision_closed":
        decisionsClosed.add(String(p.decision));
        break;
      case "stage_recorded":
        stages.push({ pr: String(p.pr), stage: p.stage as Stage });
        break;
      case "flow_expanded":
        flows.push({ flow: String(p.flow), version: String(p.version), parent: String(p.parent), steps: (p.steps as string[]) ?? [] });
        break;
      case "flow_step_skipped":
        skipped.set(`${String(e.subject ?? "").replace(/^item:/, "")}/${String(p.step)}`, String(p.reason));
        break;
      case "owner_action":
        ownerActions.add(e.seq);
        break;
    }
  }
  return {
    edges: [...live.values()].sort((a, b) => a.seq - b.seq),
    removals,
    items,
    aliases,
    prs,
    decisionsOpened,
    decisionsClosed,
    stages,
    flows,
    skipped,
    ownerActions,
    ownerVerify: ownerVerify(events),
  };
}
