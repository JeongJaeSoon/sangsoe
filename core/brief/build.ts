import type { ItemReading, ItemState, OwnerTodoRow, WaitsOn } from "../contract/index.ts";
import { ITEM_READINGS, READING_LABEL, STATE_LABEL } from "../contract/index.ts";
import { linkedActs } from "../owner/link.ts";
import { item_timeline } from "../store/views/item_timeline.ts";
import { graphRead } from "../graph/read.ts";
import type { GraphRead } from "./graph.ts";
import { groupBriefFrom } from "./group.ts";
import { type ItemFacts, itemFacts, OTHERS, rank } from "./item_status.ts";
import { ownerTodoFrom } from "./owner_todo.ts";
import { localShort } from "./time.ts";
import type {
  BriefInput,
  BriefOptions,
  Cell,
  Column,
  GroupDetail,
  ItemDetail,
  Overview,
  Row,
  Table,
  UnlinkedAct,
} from "./types.ts";
import { prLabel, prUrl, since } from "./width.ts";

export interface BuildOptions extends BriefOptions {
  readonly graph?: GraphRead;
}

// The marker is the label's first word, so the brief and the panel's note cannot drift apart.
const EMOJI = Object.fromEntries(ITEM_READINGS.map((r) => [r, READING_LABEL[r].split(" ")[0]])) as Readonly<Record<ItemReading, string>>;
const ORDER: readonly ItemReading[] = ["pr_closed", "blocked", "unknown", "in_progress", "pending_verify", "ready", "planned", "on_hold"];
const WAITS: Readonly<Record<WaitsOn, string>> = { owner: "오너", reviewer: "리뷰어", infra: "인프라", lead: "리드", worker: "워커" };
const ALARM_NEXT: Readonly<Record<string, string>> = {
  ci_failed: "CI 수정",
  worker_stuck: "멈춤 확인",
  worker_dead: "재시작",
  land_failed: "land 확인",
  loop_detected: "반복 확인",
  decision_untracked: "결정 연결",
  pr_changes_requested: "리뷰 변경 요청 반영",
  review_commented: "리뷰 코멘트에 답",
  refusal_report: "거부 보고 확인",
};

const COLS = {
  decisions: [c("ID", 4), c("결정", 20), c("추천", 16), c("묶음", 14), c("경과", 6)],
  ownerTodo: [c("ID", 4), c("할 일", 22), c("풀리는 일", 16), c("어디서", 10), c("경과", 6)],
  inProgress: [c("상태", 4), c("항목", 24), c("PR", 12), c("다음", 12), c("누가", 10)],
  onHold: [c("상태", 4), c("항목", 24), c("PR", 12), c("다시 볼 조건", 16), c("기간", 4)],
  why: [c("항목", 8), c("막는 선행", 10), c("간선 종류", 12), c("선행 상태", 10), c("해야 할 일", 16)],
  chain: [c("시각", 11), c("단계", 4), c("내용", 44)],
};
function c(name: string, max: number): Column {
  return { name, max };
}

const t = (text: string, link?: string): Cell => (link ? { text, link } : { text });
const pr = (ref: string | null): Cell => (ref ? t(prLabel(ref), prUrl(ref)) : t("—"));
const PR_REF = /\b([a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9][0-9]*)\b/i;
const leadName = (lead: string) => (lead === OTHERS ? "그 외" : lead);
// ISO times compare as strings; a missing time sorts last.
const byOldest = (a: string | null, b: string | null) => {
  const x = a ?? "￿";
  const y = b ?? "￿";
  return x < y ? -1 : x > y ? 1 : 0;
};
const table = (title: string, columns: readonly Column[], rows: Row[]): Table => ({
  title,
  count: rows.filter((r) => !r.id.startsWith("lead:")).length,
  columns,
  rows,
});

function next(f: ItemFacts): string {
  let base = "—";
  if (f.openDecisions[0]) base = `${f.openDecisions[0]} 답`;
  else if (f.undelivered[0]) base = `${f.undelivered[0]} 전달`;
  else if (f.state === "pr_closed") base = "PR 이 머지 없이 닫힘: 다시 열거나 항목을 취소";
  else if (f.state === "unknown") base = "PR 상태를 아직 읽지 못함(pr-monitor)";
  else if (f.state === "pending_verify") base = "검증 대기: verify probe 통과 전";
  else if (f.state === "blocked") base = f.lastReason ?? "—";
  else if (f.state === "ready") base = "시작";
  else if (f.state === "planned") base = "선행 대기";
  else if (f.idle) base = "워커가 다음 지시를 기다림";
  const alarm = f.alarms[0];
  if (!alarm) return base;
  return `🚨 ${base === "—" ? (ALARM_NEXT[alarm] ?? alarm) : base}`;
}

function who(f: ItemFacts, now: string): string {
  if (f.state === "blocked" || f.state === "pr_closed") return `${f.waitsOn ? WAITS[f.waitsOn] : "—"} ${since(f.since, now)}`;
  if (f.state === "in_progress") return `${f.assignee ?? "워커"} ${since(f.since, now)}`;
  return "—";
}

const itemRow = (f: ItemFacts, now: string, nest: boolean): Row => ({
  id: f.alias,
  cells: [t(EMOJI[f.state]), t(`${nest ? "└ " : ""}${f.alias} ${f.title}`), pr(f.pr), t(next(f)), t(who(f, now))],
});

const inGroupOrder = (a: ItemFacts, b: ItemFacts) =>
  ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || rank(a.priority) - rank(b.priority) || byOldest(a.since, b.since);

function unlinkedActs(input: BriefInput, showHours: number): UnlinkedAct[] {
  const cutoff = Date.parse(input.now) - showHours * 3_600_000;
  const linked = linkedActs(input.events);
  return input.events
    .filter((e) => e.type === "owner_act_unlinked" && !linked.has(e.seq) && Date.parse(e.ts) > cutoff && Date.parse(e.ts) <= Date.parse(input.now))
    .map((e) => {
      const act = String(e.payload.act);
      const ref = PR_REF.exec(act)?.[1]?.toLowerCase() ?? null;
      return { id: `act:${ref ?? e.seq}`, seq: e.seq, act, pr: ref, since: e.ts };
    });
}

/**
 * Stage 1 (decision 89). One pass over the item facts fills the four tables and `summary` together,
 * so the renderer and the panel never count again. Reads owner_todo, decision, group_brief and the
 * item facts behind item_status/group_items; writes nothing.
 */
export function buildBrief(input: BriefInput, opts: BuildOptions = {}): Overview {
  const doneDays = opts.doneDays ?? 7;
  const now = input.now;
  const facts = itemFacts(input, opts.graph ?? graphRead);
  const byAlias = new Map(facts.map((f) => [f.alias, f]));
  const todo = ownerTodoFrom(input, facts);
  const groups = groupBriefFrom(input, facts);
  const todoItems = new Set(todo.filter((r) => r.kind === "owner_item" || r.kind === "waiting_human").map((r) => r.ref));
  const windowStart = Date.parse(now) - doneDays * 86_400_000;

  let done = 0;
  let doing = 0;
  let left = 0;
  let blocked = 0;
  let evidenceShort = 0;
  const groupRows = new Map<string, ItemFacts[]>();
  const held: ItemFacts[] = [];
  for (const f of facts) {
    if (f.state === "cancelled") continue;
    if (f.state === "done") {
      if (f.closedAt && Date.parse(f.closedAt) >= windowStart) {
        done++;
        if (f.evidenceShort) evidenceShort++;
      }
      continue;
    }
    if (todoItems.has(f.alias)) {
      blocked++;
      continue;
    }
    if (f.state === "on_hold") {
      left++;
      held.push(f);
      continue;
    }
    if (f.state === "blocked" || f.state === "pr_closed") blocked++;
    else if (f.state === "in_progress" || f.state === "pending_verify") doing++;
    else left++;
    groupRows.set(f.lead, [...(groupRows.get(f.lead) ?? []), f]);
  }

  const acts = unlinkedActs(input, opts.showHours ?? 24);
  if (acts.length > 0 && !groupRows.has(OTHERS)) groupRows.set(OTHERS, []);
  const meta = new Map(groups.map((g) => [g.lead, g]));
  const leadOrder = [...groupRows.keys()].sort((a, b) => {
    const ga = meta.get(a);
    const gb = meta.get(b);
    const pa = ga ? rank(ga.priority) : 2;
    const pb = gb ? rank(gb.priority) : 2;
    const oa = (groupRows.get(a) ?? []).filter((f) => f.state === "blocked").map((f) => f.since).sort(byOldest)[0] ?? null;
    const ob = (groupRows.get(b) ?? []).filter((f) => f.state === "blocked").map((f) => f.since).sort(byOldest)[0] ?? null;
    return pa - pb || byOldest(oa, ob) || leadName(a).localeCompare(leadName(b));
  });

  const progress: Row[] = [];
  for (const lead of leadOrder) {
    const items = [...(groupRows.get(lead) ?? [])].sort(inGroupOrder);
    const blockedHere = items.filter((f) => f.state === "blocked");
    const oldest = [...blockedHere].sort((a, b) => byOldest(a.since, b.since))[0];
    const top = items[0];
    progress.push({
      id: `lead:${lead}`,
      cells: [
        t(top ? EMOJI[top.state] : "—"),
        { text: leadName(lead), tail: ` ${meta.get(lead)?.priority ?? "P2"}`, strong: true },
        t("—"),
        t(`${meta.get(lead)?.items ?? 0}건·막힘 ${meta.get(lead)?.blocked ?? 0}`),
        t(oldest ? who(oldest, now) : "—"),
      ],
    });
    for (const f of items) progress.push(itemRow(f, now, true));
    if (lead === OTHERS) {
      for (const a of acts) {
        progress.push({ id: a.id, cells: [t("—"), t(`└ ${a.act}`), pr(a.pr), t("오너 직접 · 연결?"), t(`오너 ${since(a.since, now)}`)] });
      }
    }
  }

  const decisionRows = todo
    .filter((r) => r.kind === "decision")
    .sort((a, b) => byOldest(a.since, b.since))
    .map((r) => decisionRow(input, r, facts));
  const todoRows = todo
    .filter((r) => r.kind !== "decision")
    .sort((a, b) => byOldest(a.since, b.since))
    .map((r) => todoRow(input, r, byAlias, facts));
  const holdRows = held
    .sort((a, b) => byOldest(a.since, b.since))
    .map((f) => ({
      id: f.alias,
      cells: [t(EMOJI.on_hold), t(`${f.alias} ${f.title}`), pr(f.pr), t(f.reviewTrigger ?? "—"), t(since(f.since, now))],
    }));

  const decisions = decisionRows.length;
  return {
    stage: 1,
    now,
    groups: groups.length,
    todo: { total: todo.length, decisions, other: todo.length - decisions },
    summary: { done, doing, left, blocked },
    decisions: table("결정 필요", COLS.decisions, decisionRows),
    ownerTodo: table("지금 오너가 할 일", COLS.ownerTodo, todoRows),
    inProgress: table("진행 중", COLS.inProgress, progress),
    onHold: holdRows.length > 0 ? table("보류", COLS.onHold, holdRows) : null,
    doneDays,
    evidenceShort,
  };
}

function gateFor(input: BriefInput, d: string) {
  return input.orca.gates.find((g) => g.question?.startsWith(`${d}:`));
}

function waitersOf(input: BriefInput, d: string): string[] {
  return input.events
    .filter((e) => (e.type === "decision_opened" && e.payload.decision === d && e.payload.task) || (e.type === "decision_joined" && e.payload.decision === d))
    .map((e) => String(e.payload.task ?? e.payload.waiter));
}

function decisionRow(input: BriefInput, r: OwnerTodoRow, facts: readonly ItemFacts[]): Row {
  const gate = gateFor(input, r.ref);
  const question = gate?.question?.replace(/^d\d+:\s*/, "") ?? "—";
  const first = facts.find((f) => f.task === waitersOf(input, r.ref)[0]);
  return {
    id: r.ref,
    cells: [t(r.ref), t(question), t(gate?.options?.[0] ?? "—"), t(first ? leadName(first.lead) : "—"), t(since(r.since, input.now))],
  };
}

function todoRow(input: BriefInput, r: OwnerTodoRow, byAlias: ReadonlyMap<string, ItemFacts>, facts: readonly ItemFacts[]): Row {
  const age = t(since(r.since, input.now));
  if (r.kind === "undelivered_answer") {
    const unblocks = waitersOf(input, r.ref)
      .map((task) => facts.find((f) => f.task === task))
      .filter((f): f is ItemFacts => f !== undefined)
      .map((f) => `${f.alias} ${f.title}`);
    return { id: r.ref, cells: [t(r.ref), t("답 다시 보내기"), t(unblocks.join(", ") || "—"), t("sangsoe"), age] };
  }
  if (r.kind === "waiting_human") return { id: r.ref, cells: [t(r.ref), t(r.whyOwner ?? "입력 대기"), t("—"), t("터미널"), age] };
  const f = byAlias.get(r.ref);
  const after = f ? facts.filter((s) => input.orca.tasks.find((x) => x.id === s.task)?.deps.includes(f.task)).map((s) => s.alias) : [];
  return { id: r.ref, cells: [t(r.ref), t(f?.title ?? r.ref), t(after.join(", ") || "—"), t(f?.cmdHint ?? "—"), age] };
}

/** Stage 2: one group's rows by state, its dependency edges, critical path and why-not-ready rows. */
export function buildGroup(input: BriefInput, lead: string, opts: BuildOptions = {}): GroupDetail | null {
  const graph = opts.graph ?? graphRead;
  const key = lead === "그 외" ? OTHERS : lead;
  const facts = itemFacts(input, graph);
  const meta = groupBriefFrom(input, facts).find((g) => g.lead === key);
  if (!meta) return null;
  const mine = facts.filter((f) => f.lead === key);
  const alias = new Map(facts.map((f) => [f.task, f]));
  const label = (task: string) => alias.get(task)?.alias ?? task;
  const sectionOf: [string, ItemReading[]][] = [
    ["🚧 막힘", ["pr_closed", "blocked"]],
    ["🔄 진행 중", ["in_progress", "pending_verify"]],
    ["대기열", ["unknown", "ready", "planned", "on_hold"]],
  ];
  const sections = sectionOf
    .map(([title, states]) =>
      table(title, COLS.inProgress, mine.filter((f) => states.includes(f.state)).sort(inGroupOrder).map((f) => itemRow(f, input.now, false))),
    )
    .filter((s) => s.rows.length > 0);
  const tasks = new Set(mine.map((f) => f.task));
  const edges = graph
    .edges(input)
    .filter((e) => tasks.has(e.succ) || tasks.has(e.pred))
    .map((e) => ({ pred: label(e.pred), succ: label(e.succ), kind: e.kind, met: alias.has(e.pred) ? alias.get(e.pred)?.state === "done" : null }));
  const notReady = mine.filter((f) => f.state === "planned").sort(inGroupOrder);
  const whyRows = notReady.flatMap((f) =>
    graph.why(input, f.task).map((e) => {
      const p = alias.get(e.pred);
      return {
        id: f.alias,
        cells: [t(f.alias), t(label(e.pred)), t(e.kind), t(p ? EMOJI[p.state] : "—"), t(p ? next(p) : "—")],
      };
    }),
  );
  return {
    stage: 2,
    now: input.now,
    lead: leadName(key),
    priority: meta.priority,
    items: meta.items,
    blockedCount: meta.blocked,
    sections,
    doneFolded: meta.done,
    edges,
    criticalPath: graph.criticalPath(input, [...tasks]).map(label),
    why: table("왜 준비되지 않았나", COLS.why, whyRows),
  };
}

const STAGE: Readonly<Record<string, string>> = {
  owner_action: "원문",
  owner_class: "분류",
  item_created: "생성",
  item_transition: "전환",
  evidence: "증거",
  waiting_human: "대기",
  waiting_released: "대기",
  worker_idle: "대기",
  worker_done: "보고",
  refusal_report: "거부",
  flow_step_skipped: "흐름",
  observed_change: "신호",
};

// Decision 186's nine events in the owner's words (decision 198); their writers are the monitors'.
const NINE: Readonly<Record<string, (s: (k: string) => string) => string>> = {
  pr_review_requested: (s) => `${s("pr")} 리뷰 요청 ${s("reviewer")}`,
  pr_changes_requested: (s) => `${s("pr")} 변경 요청 ${s("reviewer")}`,
  review_commented: (s) => `${s("pr")} 리뷰 코멘트 ${s("reviewer")}`,
  review_replied: (s) => `${s("pr")} 리뷰에 답함 ${s("by")}`,
  flow_step_skipped: (s) => `${s("step")} 건너뜀: ${s("reason")}`,
  worker_idle: () => "워커가 다음 지시를 기다림",
  observed_change: (s) => `Orca 에서 ${s("field")} 바뀜`,
  refusal_report: (s) => `${s("act")} 거부됨(${s("category")})`,
  // A marker only (decision 196): the outcome stays in Orca.
  worker_done: () => "워커 완료 보고 받음",
};
const SKIP = new Set(["item_extra_set", "priority_set", "item_ready"]);

function chainText(type: string, p: Record<string, unknown>): string {
  const s = (k: string) => (typeof p[k] === "string" ? String(p[k]) : "");
  if (type === "owner_action") return s("summary");
  if (type === "owner_class") return s("class");
  if (type === "item_created") return `${s("who")} · ${s("done_when")}`;
  if (type === "item_transition") {
    const from = STATE_LABEL[p.from as ItemState] ?? s("from");
    const to = STATE_LABEL[p.to as ItemState] ?? s("to");
    return `${from} → ${to} ${s("reason")}`.trim();
  }
  if (type === "evidence") return `${s("kind")}${typeof p.exit_code === "number" ? ` exit ${p.exit_code}` : ""}`;
  if (type.startsWith("decision_")) return `${s("decision")} ${type.slice(9)}${p.answer ? ` "${s("answer")}"` : ""}`;
  const nine = NINE[type];
  if (nine) return nine(s).replace(/\s+/g, " ").trim();
  return [type, s("pr")].filter(Boolean).join(" ");
}

/** Stage 3: the owner's words → class → transitions → evidence → linked PRs and decisions. */
export function buildItem(input: BriefInput, alias: string, opts: BuildOptions = {}): ItemDetail | null {
  const f = itemFacts(input, opts.graph ?? graphRead).find((x) => x.alias === alias);
  if (!f) return null;
  const rows: Row[] = item_timeline(input, f.task)
    .filter((e) => !SKIP.has(e.type))
    .map((e) => ({
      id: `seq:${e.seq}`,
      cells: [
        t(localShort(e.ts)),
        t(STAGE[e.type] ?? (e.type.startsWith("decision_") ? "결정" : typeof e.payload.pr === "string" ? "PR" : "신호")),
        t(chainText(e.type, e.payload)),
      ],
    }));
  const flags = [
    f.openDecisions.length > 0 ? "🙋" : "",
    f.alarms.length > 0 ? "🚨" : "",
    f.unclear ? "⚠️" : "",
    f.evidenceShort ? "🔍" : "",
  ].join("");
  return {
    stage: 3,
    now: input.now,
    id: f.alias,
    title: f.title,
    state: EMOJI[f.state],
    flags,
    who: f.who,
    priority: f.priority,
    chain: table("시간순", COLS.chain, rows),
  };
}
