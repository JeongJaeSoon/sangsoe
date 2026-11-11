import type { ItemReading, ItemState, OwnerTodoRow, RestartDueRow, WaitsOn } from "../contract/index.ts";
import { ITEM_READINGS, READING_LABEL, STATE_LABEL } from "../contract/index.ts";
import { isKind, localDay, POLICY, spend, spendText } from "../models/index.ts";
import { linkedActs } from "../owner/link.ts";
import { DEFAULT_RESTART_RULES, restart_due } from "../session/restart-due.ts";
import { item_timeline } from "../store/views/item_timeline.ts";
import { type Facts, foldFacts } from "../graph/facts.ts";
import { itemRef } from "../graph/nodes.ts";
import { graphRead } from "../graph/read.ts";
import { groupBriefFrom } from "./group.ts";
import { type ItemFacts, itemFacts, OTHERS, rank } from "./item_status.ts";
import { ownerTodoFrom } from "./owner_todo.ts";
import { localShort } from "./time.ts";
import type {
  BriefInput,
  BriefOptions,
  Cell,
  Column,
  GraphNodeRow,
  GroupDetail,
  GroupGraph,
  ItemDetail,
  Overview,
  Row,
  Table,
  UnlinkedAct,
} from "./types.ts";
import { prLabel, prUrl, since } from "./width.ts";

export interface BuildOptions extends BriefOptions {
  readonly graph?: GroupGraph;
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
  done: [c("항목", 28), c("PR", 12), c("닫힘", 11)],
  critical: [c("단계", 4), c("항목", 24), c("상태", 12), c("단계 이름", 16)],
  stack: [c("층", 4), c("PR", 12), c("항목", 24), c("상태", 12)],
  release: [c("단계", 12), c("조건", 28), c("항목", 24)],
  broken: [c("항목", 8), c("끊긴 선행", 24), c("처리", 32)],
  edges: [c("종류", 13), c("선행", 24), c("후속", 24), c("비고", 20)],
  recent: [c("시각", 11), c("항목", 24), c("전환", 32)],
};
const RECENT = 5;
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
  const closed: ItemFacts[] = [];
  for (const f of facts) {
    if (f.state === "cancelled") continue;
    if (f.state === "done") {
      if (f.closedAt && Date.parse(f.closedAt) >= windowStart) {
        done++;
        closed.push(f);
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
  const today = advisorToday(input);
  const restart = restartDueLines(input);
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
    done: doneTable(closed, foldFacts(input.events), doneDays),
    ...(today ? { advisorToday: today } : {}),
    ...(restart.length > 0 ? { restartDue: restart } : {}),
  };
}

// Done items drop their open PR from ItemFacts; the PR they merged is the last one bound to the Task.
const prOf = (g: Facts, task: string): string | null => [...g.prs.values()].filter((p) => p.tasks.has(task)).at(-1)?.pr ?? null;

function doneTable(closed: readonly ItemFacts[], g: Facts, doneDays: number): Table {
  const rows = [...closed]
    .sort((a, b) => -byOldest(a.closedAt, b.closedAt))
    .map((f) => ({ id: f.alias, cells: [t(`${f.alias} ${f.title}`), pr(prOf(g, f.task)), t(localShort(f.closedAt ?? ""))] }));
  return table(`✅ 완료 최근 ${doneDays}일`, COLS.done, rows);
}

function gateFor(input: BriefInput, d: string) {
  return input.orca.gates.find((g) => g.question?.startsWith(`${d}:`));
}

function waitersOf(input: BriefInput, d: string): string[] {
  return input.events
    .filter((e) => (e.type === "decision_opened" && e.payload.decision === d && e.payload.task) || (e.type === "decision_joined" && e.payload.decision === d))
    .map((e) => String(e.payload.task ?? e.payload.waiter));
}

/**
 * A decision whose question no read gate carries is a broken row (decision 219): no gate was ever
 * recorded (an Orca refusal after decision_opened, as before decision 197's gate-less join), or its
 * gate's Run was not read. Either way there is nothing to answer, so the panel draws it without buttons.
 */
export const BROKEN_DECISION = { unrecorded: "기록 깨짐: Orca 게이트 없이 열림", unread: "게이트를 읽지 못함" } as const;

function decisionRow(input: BriefInput, r: OwnerTodoRow, facts: readonly ItemFacts[]): Row {
  const gate = gateFor(input, r.ref);
  const first = facts.find((f) => f.task === waitersOf(input, r.ref)[0]);
  const age = t(since(r.since, input.now));
  if (!gate?.question) {
    const recorded = input.events.some((e) => (e.type === "decision_opened" || e.type === "decision_joined") && e.payload.decision === r.ref && typeof e.payload.gate === "string");
    const why = recorded ? BROKEN_DECISION.unread : BROKEN_DECISION.unrecorded;
    return { id: r.ref, broken: true, cells: [t(r.ref), t(why), t("—"), t(first ? leadName(first.lead) : "—"), age] };
  }
  const question = gate.question.replace(/^d\d+:\s*/, "");
  return { id: r.ref, cells: [t(r.ref), t(question), t(gate.options?.[0] ?? "—"), t(first ? leadName(first.lead) : "—"), age] };
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

/**
 * Stage 2: one group's rows by state, its DAG (edges, nodes, critical path), why-not-ready rows, and the
 * decision-199 parts: summary figures, stack, release bundles, broken predecessors, edge list, recent
 * transitions and the folded done list.
 */
export function buildGroup(input: BriefInput, lead: string, opts: BuildOptions = {}): GroupDetail | null {
  const graph = opts.graph ?? graphRead;
  const key = lead === "그 외" ? OTHERS : lead;
  const facts = itemFacts(input, graph);
  const meta = groupBriefFrom(input, facts).find((g) => g.lead === key);
  if (!meta) return null;
  const mine = facts.filter((f) => f.lead === key);
  const tasks = new Set(mine.map((f) => f.task));
  const g = foldFacts(input.events);
  // Decision 218: an open PR predecessor bound to an item of this group is that item, unless it is the
  // successor's own PR; a merged or closed one stays the PR, so its edge reads met from the PR (as itemGraph).
  const resolve = (pred: string, succ: string): string => {
    const pr = pred.startsWith("pr:") ? g.prs.get(pred.slice(3)) : undefined;
    return (pr && !pr.merged && !pr.closed && [...pr.tasks].find((t) => tasks.has(t) && t !== succ)) || pred;
  };
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
  const seen = new Set<string>();
  const raw = graph
    .edges(input)
    .filter((e) => tasks.has(e.succ) || tasks.has(e.pred))
    .map((e) => ({ ...e, pred: resolve(e.pred, e.succ) }))
    .filter((e) => {
      const id = `${e.pred}>${e.succ}:${e.kind}`;
      return !seen.has(id) && !!seen.add(id);
    });
  const edges = raw.map((e) => ({ pred: label(e.pred), succ: label(e.succ), kind: e.kind, met: alias.has(e.pred) ? alias.get(e.pred)?.state === "done" : null }));
  const open = mine.filter((f) => f.state !== "done" && f.state !== "cancelled").sort(inGroupOrder);
  // Every open item; a 🚧 one always has a row (decision 218).
  const whyOf = open.map((f) => {
    const rows = graph.why(input, f.task).map((e) => ({ ...e, pred: resolve(e.pred, e.succ) }));
    return [f, rows.filter((e, i) => rows.findIndex((o) => o.pred === e.pred && o.kind === e.kind) === i)] as const;
  });
  const whyRows: Row[] = whyOf.flatMap(([f, rows]) =>
    rows.map((e) => {
      const p = alias.get(e.pred);
      const state = e.dangling || !p ? e.predState : EMOJI[p.state];
      // Orca's 🚧 names no predecessor: the lead's reason on the item is what it waits on.
      const todo = e.dangling ? e.todo : p ? next(p) : e.kind === "orca" ? (f.lastReason ?? e.todo) : e.todo || "—";
      return { id: f.alias, cells: [t(f.alias), t(label(e.pred)), t(e.kind), t(state), t(todo)], ...(e.dangling ? { broken: true } : {}) };
    }),
  );
  const dangling = whyOf.flatMap(([f, rows]) => rows.filter((e) => e.dangling).map((e) => ({ f, e })));
  const brokenEdges = dangling.map(({ e }) => `${label(e.pred)}>${label(e.succ)}:${e.kind}`);
  const critical = graph.criticalPath(input, [...tasks]);
  const titled = (f: ItemFacts) => `${f.alias} ${f.title}`;
  const stateText = (f: ItemFacts | undefined) => (f ? READING_LABEL[f.state] : "—");

  // Decision 219 (12): every item the critical path or a why row names is drawn, an edgeless one too.
  const named = [...raw.flatMap((e) => [e.pred, e.succ]), ...critical, ...whyOf.flatMap(([f, rows]) => (rows.length > 0 ? [f.task, ...rows.map((e) => e.pred)] : []))];
  const nodes: GraphNodeRow[] = [...new Set(named)]
    .map((task) => alias.get(task))
    .filter((f): f is ItemFacts => f !== undefined)
    .map((f) => ({ id: f.alias, title: f.title, state: EMOJI[f.state], stateLabel: READING_LABEL[f.state], flags: flagsOf(f), outside: f.lead === key ? null : leadName(f.lead) }));

  const criticalRows: Row[] = critical.map((task, i) => {
    const f = alias.get(task);
    const x = g.items.get(task);
    const name = [x?.step ?? "", i === 0 ? "지금 늦추는 것" : "", x?.execBy === "owner" ? "오너 게이트" : ""].filter(Boolean).join(", ");
    return { id: label(task), cells: [t(String(i + 1)), t(f ? titled(f) : label(task)), t(`${stateText(f)}${f && flagsOf(f) ? ` ${flagsOf(f)}` : ""}`), t(name || "—")] };
  });

  const stacked = raw.filter((e) => e.kind === "stacked_on" && alias.has(e.pred) && alias.has(e.succ));
  const above = (task: string) => stacked.filter((e) => e.pred === task).map((e) => e.succ);
  const stackRows: Row[] = [];
  const placed = new Set<string>();
  const climb = (task: string, floor: number) => {
    if (placed.has(task)) return;
    placed.add(task);
    const f = alias.get(task) as ItemFacts;
    stackRows.push({ id: f.alias, cells: [t(`${floor}층`), pr(f.pr ?? prOf(g, task)), t(titled(f)), t(stateText(f))] });
    for (const s of above(task)) climb(s, floor + 1);
  };
  for (const e of stacked) if (!stacked.some((x) => x.succ === e.pred)) climb(e.pred, 1);

  const deps = new Map(input.orca.tasks.map((x) => [x.id, x.deps]));
  const release = g.flows
    .filter((fl) => tasks.has(fl.parent))
    .map((fl) => {
      const stepTask = new Map([...g.items.values()].filter((x) => x.flow === fl.parent && x.step).map((x) => [x.task, x.step as string]));
      const order = (task: string) => fl.steps.indexOf(stepTask.get(task) ?? "");
      const rows: Row[] = [];
      for (const task of [...stepTask.keys()].sort((a, b) => order(a) - order(b))) {
        const members = (deps.get(task) ?? []).filter((d) => !stepTask.has(d));
        if (members.length > 0) {
          const shown = members.map((m) => alias.get(m)).map((f, i) => (f ? `${f.alias} ${EMOJI[f.state]} ${prOf(g, f.task) ?? ""}`.trim() : (members[i] as string)));
          rows.push({ id: `merge:${label(task)}`, cells: [t("머지"), t(`구성원 ${members.length}건이 모두 머지`), t(shown.join(", "))] });
        }
        const ins = [
          ...(deps.get(task) ?? []).filter((d) => stepTask.has(d)).map((d) => `${stepTask.get(d)} 완료 뒤`),
          ...(members.length > 0 ? ["구성원이 모두 머지된 뒤"] : []),
          ...g.edges
            .filter((e) => e.succ === itemRef(task))
            .map((e) => {
              const p = e.pred.startsWith("item:") ? e.pred.slice(5) : e.pred;
              const s = stepTask.get(p);
              if (s) return e.kind === "deploys_after" ? `${s} 단계 기록 뒤` : `${s} 완료 뒤`;
              return `${label(p)} ${e.kind}`;
            }),
          ...(g.items.get(task)?.execBy === "owner" ? ["오너 게이트"] : []),
        ];
        const f = alias.get(task);
        rows.push({ id: label(task), cells: [t(stepTask.get(task) as string), t(ins.join(", ") || "—"), t(f ? `${f.alias} ${EMOJI[f.state]}` : label(task))] });
      }
      return table(`릴리스 묶음 ${fl.flow} · ${label(fl.parent)}`, COLS.release, rows);
    });

  const brokenRows: Row[] = dangling.map(({ f, e }) => {
    const p = alias.get(e.pred);
    return { id: f.alias, broken: true, cells: [t(f.alias), t(`${p ? titled(p) : label(e.pred)} ${e.predState.replace(" (끊긴 선행)", "")} (${e.kind})`), t(e.todo)] };
  });

  const step = new Map(critical.map((task, i) => [label(task), i + 1]));
  const edgeRows: Row[] = raw.map((e, i) => {
    const row = edges[i] as (typeof edges)[number];
    const id = `${row.pred}>${row.succ}:${row.kind}`;
    const p = alias.get(e.pred);
    const s = alias.get(e.succ);
    const a = step.get(row.pred);
    const b = step.get(row.succ);
    const note = brokenEdges.includes(id)
      ? "끊긴 선행"
      : [
          a !== undefined && b !== undefined && b === a + 1 ? `크리티컬 패스 ${a}에서 ${b}` : "",
          !p ? "그림 밖 선행" : p.lead !== key ? `외부 선행 ${leadName(p.lead)}` : "",
          row.met ? "충족" : "",
        ]
          .filter(Boolean)
          .join(", ");
    const end = (f: ItemFacts | undefined, name: string) => (f ? `${titled(f)} ${EMOJI[f.state]}` : name);
    return { id, cells: [t(row.kind), t(end(p, row.pred)), t(end(s, row.succ)), t(note || "—")], ...(brokenEdges.includes(id) ? { broken: true } : {}) };
  });

  const recentRows: Row[] = input.events
    .filter((e) => e.type === "item_transition" && tasks.has(String(e.payload.task)) && Date.parse(e.ts) <= Date.parse(input.now))
    .sort((a, b) => -byOldest(a.ts, b.ts) || b.seq - a.seq)
    .slice(0, RECENT)
    .map((e) => {
      const f = alias.get(String(e.payload.task)) as ItemFacts;
      const p = e.payload;
      const move = `${STATE_LABEL[p.from as ItemState] ?? String(p.from)} → ${STATE_LABEL[p.to as ItemState] ?? String(p.to)} ${typeof p.reason === "string" ? p.reason : ""}`.trim();
      return { id: `seq:${e.seq}`, cells: [t(localShort(e.ts)), t(titled(f)), t(move)] };
    });

  const doneDays = opts.doneDays ?? 7;
  const windowStart = Date.parse(input.now) - doneDays * 86_400_000;
  const closed = mine.filter((f) => f.state === "done" && f.closedAt !== null && Date.parse(f.closedAt) >= windowStart);
  const count = (...states: ItemReading[]) => open.filter((f) => states.includes(f.state)).length;
  return {
    stage: 2,
    now: input.now,
    lead: leadName(key),
    priority: meta.priority,
    // Decision 218: 건 is the open items (🔄 + 🚧 + 남은 것); ✅ is counted apart from it.
    items: open.length,
    blockedCount: count("blocked", "pr_closed"),
    sections,
    doneFolded: meta.done,
    edges,
    criticalPath: critical.map(label),
    why: table("왜 준비되지 않았나", COLS.why, whyRows),
    figures: {
      done: closed.length,
      doneDays,
      doing: count("in_progress", "pending_verify"),
      blocked: count("blocked", "pr_closed"),
      left: count("unknown", "ready", "planned", "on_hold"),
      planned: count("planned", "unknown"),
      ready: count("ready"),
      onHold: count("on_hold"),
      owner: open.filter((f) => f.openDecisions.length > 0 || f.undelivered.length > 0).length,
      flags: open.filter((f) => f.alarms.length > 0).length,
    },
    nodes,
    brokenEdges,
    critical: table("크리티컬 패스", COLS.critical, criticalRows),
    stack: table("스택 PR 체인", COLS.stack, stackRows),
    release,
    broken: table("끊긴 선행", COLS.broken, brokenRows),
    edgeList: table("간선", COLS.edges, edgeRows),
    recent: table("최근 전환", COLS.recent, recentRows),
    done: doneTable(closed, g, doneDays),
  };
}

const flagsOf = (f: ItemFacts): string => `${f.openDecisions.length > 0 || f.undelivered.length > 0 ? "🙋" : ""}${f.alarms.length > 0 ? "🚨" : ""}`;

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
// unit_started and advisor_used are drawn once, as the item's model line (decision 200).
const SKIP = new Set(["item_extra_set", "priority_set", "item_ready", "unit_started", "advisor_used"]);

/** Decision 200: the row the last start picked, and the unit's advisor spend against its budget. */
function modelLine(input: BriefInput, task: string): string | undefined {
  const last = input.events.filter((e) => e.type === "unit_started" && e.entity_id === task).at(-1);
  const kind = String(last?.payload.kind ?? "");
  if (!last || !isKind(kind)) return undefined;
  const p = last.payload;
  const advisor = typeof p.advisor === "string" ? ` · advisor ${p.advisor}` : " · advisor 없음";
  // The budget the start recorded, counted over the same span: a day-budget row counts today.
  const daily = p.budget_per === "day";
  const used = spend(input.events.filter((e) => e.type === "advisor_used"), { task, ...(daily ? { day: localDay(new Date(input.now)) } : {}) });
  return `모델: ${POLICY[kind].label} · ${String(p.model)} · effort ${String(p.effort)}${advisor} · 예산 ${Number(p.budget)}회/${daily ? "하루" : "단위"} · ${spendText(used)}`;
}

const RESTART_RULE: Record<RestartDueRow["rule"], string> = {
  compactions: "자동 압축 누적",
  first_call_half: "압축 뒤 첫 턴이 압축 전의 절반 이상",
  compaction_interval: "압축 간격이 짧음",
  token_ceiling: "토큰 상한",
};

/**
 * Design N1: the orchestrator's and leads' sessions restart_due names, one line each. Only a role's
 * latest session counts: a /clear or a new start records a newer session_started for the same Task
 * (or, without one, the same held Run), and the old session's rows no longer say anything. A lead
 * whose Task is closed has ended and is not listed.
 */
export function restartDueLines(input: BriefInput): string[] {
  const closed = new Set(input.orca.tasks.filter((t) => t.status === "completed" || t.status === "failed").map((t) => t.id));
  const latest = new Map<string, { session: string; who: string; task?: string }>();
  for (const e of input.events) {
    if (e.type !== "session_started") continue;
    const role = String(e.payload.role);
    if (role !== "orchestrator" && role !== "lead") continue;
    // The Run it holds, else the Task its Dispatch runs: a lead started by start_unit has both.
    const run = e.target ?? e.subject ?? "";
    latest.set(`${role}\n${e.entity_id ?? e.target ?? ""}`, {
      session: String(e.payload.session),
      who: `${role}${run ? ` ${run}` : ""}`,
      ...(e.entity_id ? { task: e.entity_id } : {}),
    });
  }
  const live = new Map([...latest.values()].filter((s) => !(s.task && closed.has(s.task))).map((s) => [s.session, s.who]));
  const rules = new Map<string, string[]>();
  for (const r of restart_due(input, DEFAULT_RESTART_RULES)) if (live.has(r.session)) rules.set(r.session, [...(rules.get(r.session) ?? []), RESTART_RULE[r.rule]]);
  return [...rules].map(([s, why]) => `♻️ 재시작 권함 · ${live.get(s)} · ${why.join(", ")} · handoff_save 뒤 /clear`);
}

/** Decision 200: today's advisor calls over every session; undefined on a day with none. */
function advisorToday(input: BriefInput): string | undefined {
  const s = spend(input.events.filter((e) => e.type === "advisor_used"), { day: localDay(new Date(input.now)) });
  return s.calls > 0 ? `오늘 ${spendText(s)}` : undefined;
}

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
  const model = modelLine(input, f.task);
  return {
    stage: 3,
    now: input.now,
    id: f.alias,
    title: f.title,
    state: EMOJI[f.state],
    flags,
    who: f.who,
    priority: f.priority,
    lead: leadName(f.lead),
    ...(model ? { model } : {}),
    chain: table("시간순", COLS.chain, rows),
  };
}
