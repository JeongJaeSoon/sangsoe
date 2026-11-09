import type { ReadyRow, ViewInput, ViewTask } from "../contract/views.ts";
import { type EdgeKind, type Facts, foldFacts, type Stage } from "./facts.ts";
import { itemRef, parseNode } from "./nodes.ts";

// ready is computed, never stored (decision 26, 76(9)). An edge is ok (1), not ok (0) or unknown
// (null); unknown is not ready (`IS NOT 1`, #622). A cancelled predecessor does not release a
// blocks / stacked_on / deploys_after successor: it is a dangling predecessor the lead resolves.

export type Ok = 1 | 0 | null;

export interface EdgeState {
  readonly ok: Ok;
  /** The predecessor's state as the why table's 선행 상태 column shows it. */
  readonly predState: string;
  readonly dangling: boolean;
  /** What unblocks it: the why table's 해야 할 일 column. */
  readonly todo: string;
}

/** An edge into an item, wherever it lives: Orca deps or an extra edge. */
export interface InEdge {
  readonly pred: string;
  readonly kind: EdgeKind;
  readonly where: "orca" | "extra";
}

export interface WhyRow {
  /** 항목: the iNNN alias, or the Task id when there is none. */
  readonly item: string;
  /** 막는 선행: a node name, or `trigger` / `hold` for those rows. */
  readonly pred: string;
  /** 간선 종류. */
  readonly kind: EdgeKind | "trigger" | "hold" | "orca";
  readonly predState: string;
  readonly dangling: boolean;
  readonly todo: string;
}

export type Readiness = "ready" | "owner_ready" | "waiting" | "not_waiting" | "unknown";

export interface WhyReport {
  readonly task: string;
  readonly item: string;
  readonly readiness: Readiness;
  /** One row per blocking predecessor (and unmet trigger or hold); empty when ready. */
  readonly rows: readonly WhyRow[];
}

const CANCELLED = (t: ViewTask) => t.status === "failed" && t.result === "cancelled";
const DONE = (t: ViewTask) => t.status === "completed";

export function taskState(t: ViewTask | undefined): string {
  if (!t) return "모름: Orca 에서 이 Task 를 읽지 못했다";
  if (DONE(t)) return "✅ 완료";
  if (CANCELLED(t)) return "🗑️ 취소";
  if (t.status === "failed") return "🗑️ 실패";
  if (t.status === "dispatched") return "🔄 진행 중";
  if (t.status === "blocked") return "🚧 막힘";
  return "📅 예정";
}

const tasksById = (input: ViewInput) => new Map(input.orca.tasks.map((t) => [t.id, t]));

/** PRs bound to items of the same flow as `task`, and to those items' Orca deps (ship-batch members). */
function flowPrs(task: string, facts: Facts, tasks: ReadonlyMap<string, ViewTask>): string[] {
  const flow = facts.items.get(task)?.flow;
  const members = new Set<string>([task]);
  if (flow !== undefined) for (const x of facts.items.values()) if (x.flow === flow || x.task === flow) members.add(x.task);
  for (const m of [...members]) for (const d of tasks.get(m)?.deps ?? []) members.add(d);
  return [...facts.prs.values()].filter((p) => [...p.tasks].some((t) => members.has(t))).map((p) => p.pr);
}

function prState(pr: string, facts: Facts): { merged: boolean; closed: boolean; known: boolean } {
  const f = facts.prs.get(pr);
  return { merged: !!f?.merged, closed: !!f?.closed && !f?.merged, known: !!f && (f.opened || f.merged || f.closed) };
}

export function edgeOk(e: InEdge, facts: Facts, tasks: ReadonlyMap<string, ViewTask>): EdgeState {
  const node = parseNode(e.pred);
  const wait = (predState: string, todo: string): EdgeState => ({ ok: 0, predState, dangling: false, todo });
  const dangling = (predState: string): EdgeState => ({
    ok: 0,
    predState: `${predState} (끊긴 선행)`,
    dangling: true,
    todo: "리드: 간선을 빼거나(이유 필수) 후속을 취소한다",
  });
  const unknown = (why: string): EdgeState => ({ ok: null, predState: `모름: ${why}`, dangling: false, todo: "선행 상태를 다시 읽는다(모름은 준비됨이 아니다)" });
  const met = (predState: string): EdgeState => ({ ok: 1, predState, dangling: false, todo: "" });
  if (!node) return unknown(`선행 이름 ${e.pred} 을 읽지 못했다`);

  if (node.kind === "decision") {
    if (facts.decisionsClosed.has(node.decision)) return met("닫힘");
    return facts.decisionsOpened.has(node.decision) ? wait("열림", "오너의 답을 기다린다") : unknown("결정 기록이 없다");
  }

  if (node.kind === "pr") {
    const s = prState(node.pr, facts);
    if (!s.known) return unknown("PR 상태를 읽지 못했다");
    if (e.kind === "after") return s.merged || s.closed ? met(s.merged ? "머지됨" : "닫힘") : wait("열림", "선행 PR 머지를 기다린다");
    if (s.closed) return dangling("머지 없이 닫힘");
    if (!s.merged) return wait("열림", "선행 PR 머지를 기다린다");
    if (e.kind === "deploys_after") {
      return facts.stages.some((x) => x.pr === node.pr && x.stage === "merge") ? met("머지됨 · merge 기록") : wait("머지됨 · merge 기록 없음", "stage_recorded(merge) 를 남긴다");
    }
    return met("머지됨");
  }

  const t = tasks.get(node.task);
  const state = taskState(t);
  if (!t) return unknown("Orca 에서 이 Task 를 읽지 못했다");
  // Decision 26: after ends on ✅ or 🗑️; every other kind leaves a 🗑️ predecessor dangling for the lead.
  if (t.status === "failed") return e.kind === "after" ? met(state) : dangling(state);
  switch (e.kind) {
    case "blocks":
      return DONE(t) ? met(state) : wait(state, "선행 항목 ✅ 완료를 기다린다");
    case "after":
      return DONE(t) ? met(state) : wait(state, "선행 항목이 끝나기를 기다린다");
    case "stacked_on": {
      const mine = [...facts.prs.values()].filter((p) => p.tasks.has(node.task)).map((p) => p.pr);
      if (mine.length === 0) return unknown("선행 항목에 붙은 PR 을 모른다");
      const states = mine.map((pr) => prState(pr, facts));
      if (states.some((s) => s.closed)) return dangling("선행 PR 이 머지 없이 닫힘");
      return states.every((s) => s.merged) ? met("선행 PR 머지됨") : wait("선행 PR 열림", "선행 PR 머지를 기다린다");
    }
    case "deploys_after": {
      const prs = flowPrs(node.task, facts, tasks);
      if (prs.length === 0) return unknown("이 흐름에 붙은 PR 을 모른다");
      const states = prs.map((pr) => prState(pr, facts));
      if (states.some((s) => s.closed)) return dangling("흐름의 PR 이 머지 없이 닫힘");
      if (!states.every((s) => s.merged)) return wait("PR 머지 전", "흐름의 PR 머지를 기다린다");
      const stage: Stage = facts.items.get(node.task)?.stage ?? "merge";
      return facts.stages.some((x) => prs.includes(x.pr) && x.stage === stage)
        ? met(`머지됨 · ${stage} 기록`)
        : wait(`머지됨 · ${stage} 기록 없음`, `stage_recorded(${stage}) 를 기다린다`);
    }
  }
}

/** Every edge into the item: its Orca deps as `blocks`, then its extra edges. */
export function inEdges(task: string, facts: Facts, tasks: ReadonlyMap<string, ViewTask>): InEdge[] {
  const orca: InEdge[] = (tasks.get(task)?.deps ?? []).map((d) => ({ pred: itemRef(d), kind: "blocks", where: "orca" }));
  const extra: InEdge[] = facts.edges.filter((e) => e.succ === itemRef(task)).map((e) => ({ pred: e.pred, kind: e.kind, where: "extra" }));
  return [...orca, ...extra];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z)?$/;
const PR_REF = /^[a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9][0-9]*$/;

/** Decision 32: a trigger is a date or a PR merge. Anything else is unknown, so not ready. */
export function triggerOk(trigger: string | undefined, facts: Facts, now: string): EdgeState | null {
  if (trigger === undefined || trigger === "") return null;
  if (ISO_DATE.test(trigger)) {
    return trigger <= now
      ? { ok: 1, predState: `${trigger} 지남`, dangling: false, todo: "" }
      : { ok: 0, predState: `${trigger} 전`, dangling: false, todo: "그 날짜를 기다린다" };
  }
  if (PR_REF.test(trigger)) {
    const s = prState(trigger, facts);
    if (s.merged) return { ok: 1, predState: "머지됨", dangling: false, todo: "" };
    if (!s.known) return { ok: null, predState: "모름: PR 상태를 읽지 못했다", dangling: false, todo: "PR 상태를 다시 읽는다" };
    return s.closed
      ? { ok: 0, predState: "머지 없이 닫힘 (끊긴 선행)", dangling: true, todo: "리드: trigger 를 고치거나 항목을 취소한다" }
      : { ok: 0, predState: "열림", dangling: false, todo: "PR 머지를 기다린다" };
  }
  return { ok: null, predState: `모름: trigger ${JSON.stringify(trigger)} 는 날짜도 PR 도 아니다`, dangling: false, todo: "trigger 를 날짜나 owner/repo#N 으로 고친다" };
}

export function whyFrom(input: ViewInput, facts: Facts, task: string): WhyReport {
  const tasks = tasksById(input);
  const t = tasks.get(task);
  const x = facts.items.get(task);
  const item = x?.alias ?? task;
  if (!t) {
    return { task, item, readiness: "unknown", rows: [{ item, pred: itemRef(task), kind: "orca", predState: taskState(undefined), dangling: false, todo: "이 Task 의 Run 을 읽는다" }] };
  }
  if (t.status !== "pending" && t.status !== "ready") return { task, item, readiness: "not_waiting", rows: [] };
  const rows: WhyRow[] = [];
  for (const e of inEdges(task, facts, tasks)) {
    const s = edgeOk(e, facts, tasks);
    if (s.ok !== 1) rows.push({ item, pred: e.pred, kind: e.kind, predState: s.predState, dangling: s.dangling, todo: s.todo });
  }
  const trig = triggerOk(x?.trigger, facts, input.now);
  if (trig && trig.ok !== 1) rows.push({ item, pred: "trigger", kind: "trigger", predState: trig.predState, dangling: trig.dangling, todo: trig.todo });
  if (x?.hold) rows.push({ item, pred: "hold", kind: "hold", predState: "⏸️ 보류", dangling: false, todo: "재검토 trigger 가 차거나 리드·오너가 다시 연다" });
  const readiness: Readiness = rows.length > 0 ? "waiting" : x?.execBy === "owner" ? "owner_ready" : "ready";
  return { task, item, readiness, rows };
}

export function why(input: ViewInput, task: string): WhyReport {
  const facts = foldFacts(input.events);
  return whyFrom(input, facts, facts.aliases.get(task) ?? task);
}

/** The ReadyView (contract/views.ts): items a lead may start. Owner items are 🟢 too but go to owner_todo. */
export function ready(input: ViewInput): ReadyRow[] {
  return readiness(input)
    .filter((r) => r.readiness === "ready")
    .map((r) => ({ task: r.task, alias: r.item === r.task ? null : r.item }));
}

export function readiness(input: ViewInput): WhyReport[] {
  const facts = foldFacts(input.events);
  return input.orca.tasks.map((t) => whyFrom(input, facts, t.id));
}

/** Decision 92④'s table, one row per blocking predecessor. */
export function renderWhy(r: WhyReport): string {
  const head = r.readiness === "ready" ? "🟢 준비됨" : r.readiness === "owner_ready" ? "🟢 준비됨 (오너가 시작)" : r.readiness === "not_waiting" ? "기다리는 항목이 아니다" : r.readiness === "unknown" ? "모름" : "📅 예정";
  const lines = [`${r.item}: ${head}`];
  if (r.rows.length > 0) {
    lines.push("| 항목 | 막는 선행 | 간선 종류 | 선행 상태 | 해야 할 일 |", "|---|---|---|---|---|");
    for (const w of r.rows) lines.push(`| ${w.item} | ${w.pred} | ${w.kind} | ${w.predState} | ${w.todo} |`);
  }
  return lines.join("\n");
}
