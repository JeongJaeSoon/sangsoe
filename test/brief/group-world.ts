import assert from "node:assert/strict";
import { addEdgeTo, type BriefInput, expandFlow, type ItemState, loadFlow, planFlow } from "../../core/index.ts";
import { bindItem, createGraphWorld, type GraphWorld } from "../graph/world.ts";

// The mock's api-migration group (hallmark-final group.html), built through the writers GRAPH uses:
// bindItem as createItem does, addEdgeTo for every edge, expandFlow on the bundled ship-batch.

export const NOW = "2026-11-10T12:00:00.000Z";
const RUN = "run_api";
const LEAD = "api-migration";

export interface GroupWorld {
  readonly w: GraphWorld;
  /** Task id by the alias a test names. */
  readonly task: Readonly<Record<string, string>>;
  /** The ship-batch steps' aliases: deploy_dev, verify_dev, deploy_prod. */
  readonly steps: Readonly<Record<string, string>>;
  input(): Promise<BriefInput>;
}

const TITLES: Readonly<Record<string, string>> = {
  t26: "N+1 쿼리 제거",
  t31: "웹훅 재시도 정책",
  t33: "스테이징 키 발급",
  t37: "롤백 스크립트 점검",
  t38: "N+1 후속 정리 PR",
  t43: "후속 테스트 PR",
  t27: "캐시 도입",
  t52: "API 전환 가이드",
  t24: "인덱스 추가",
  t21: "읽기 전용 모드",
  t20: "스키마 초안",
};

export async function groupWorld(): Promise<GroupWorld> {
  const w = createGraphWorld();
  // The world's store stamps the wall clock; input() restamps every row so windows read the same each run.
  const stamped = new Map<number, string>();
  const items: [string, string, string][] = [
    ["t26", "i026", LEAD],
    ["t31", "i031", LEAD],
    ["t33", "i033", LEAD],
    ["t37", "i037", LEAD],
    ["t38", "i038", LEAD],
    ["t43", "i043", LEAD],
    ["t27", "i027", LEAD],
    ["t52", "i052", "docs"],
    ["t24", "i024", LEAD],
    ["t21", "i021", LEAD],
    ["t20", "i020", LEAD],
  ];
  for (const [task, alias, lead] of items) {
    w.task(task, RUN);
    bindItem(w, task, alias, { lead });
  }
  w.store.append({ type: "priority_set", source: "orchestrator", payload: { subject: `lead:${LEAD}`, value: "P0" } });
  w.dispatch("t26");
  w.dispatch("t52");
  for (const t of ["t31", "t33"]) (w.tasks.get(t) as { status: string }).status = "blocked";
  w.cancel("t27");
  const pr = (p: string, task: string) => w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: p, task } });
  pr("acme/api#40", "t26");
  pr("acme/api#31", "t31");
  pr("acme/api#42", "t38");
  pr("acme/api#43", "t43");
  pr("acme/api#77", "t52");
  w.store.append({ type: "item_extra_set", source: "lead", payload: { task: "t33", waits_on: "infra" } });
  const move = (task: string, from: ItemState, to: ItemState, reason: string, ts: string) =>
    stamped.set(w.store.append({ type: "item_transition", source: "lead", payload: { task, from, to, reason } }).seq, ts);
  move("t33", "in_progress", "blocked", "키 도착 확인", "2026-11-07T12:00:00.000Z");
  move("t31", "in_progress", "blocked", "d012 대기", "2026-11-09T19:00:00.000Z");
  move("t26", "ready", "in_progress", "worker-start", "2026-11-10T10:00:00.000Z");
  move("t27", "planned", "cancelled", "범위 밖", "2026-11-09T08:00:00.000Z");
  w.store.append({ type: "ci_failed", source: "pr-monitor", payload: { pr: "acme/api#40", run_id: "9001" } });
  for (const [t, ts, p] of [
    ["t24", "2026-11-07T09:00:00.000Z", "acme/api#38"],
    ["t21", "2026-11-05T09:00:00.000Z", "acme/api#35"],
    ["t20", "2026-10-20T09:00:00.000Z", "acme/api#33"],
  ] as const) {
    pr(p, t);
    w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: p, merge_sha: "abc1234" } });
    w.complete(t);
    move(t, "in_progress", "done", "머지 확인", ts);
  }

  const snap = await w.snapshot();
  const edge = (pred: string, succ: string, kind: string) => {
    const r = addEdgeTo(w, snap, { pred, succ, kind });
    assert.ok(r.ok, JSON.stringify(r));
  };
  edge("i026", "i038", "stacked_on");
  edge("i038", "i043", "stacked_on");
  edge("i027", "i043", "blocks");
  edge("acme/api#77", "i038", "after");

  const plan = planFlow(loadFlow("ship-batch"), { repo: "acme/api", members: "t31, t26" });
  assert.ok(plan.ok, JSON.stringify(plan));
  const x = await expandFlow(w, { plan: plan.value, run: RUN, who: `lead:${LEAD}`, requestId: "req-batch" });
  assert.ok(x.ok, JSON.stringify(x));
  const alias = (task: string) => w.store.events({ type: "item_created" }).find((e) => e.payload.task === task)?.payload.alias as string;
  const steps = Object.fromEntries(Object.entries(x.value.steps).map(([s, t]) => [s, alias(t)]));
  for (const t of [x.value.root, ...Object.values(x.value.steps)]) w.store.append({ type: "item_extra_set", source: "lead", payload: { task: t, lead: LEAD } });
  const snap2 = await w.snapshot();
  const r1 = addEdgeTo(w, snap2, { pred: "i033", succ: steps.verify_dev as string, kind: "blocks" });
  assert.ok(r1.ok, JSON.stringify(r1));
  const r2 = addEdgeTo(w, snap2, { pred: "i052", succ: steps.deploy_prod as string, kind: "after" });
  assert.ok(r2.ok, JSON.stringify(r2));

  const task = Object.fromEntries(w.store.events({ type: "item_created" }).map((e) => [String(e.payload.alias), String(e.payload.task)]));
  return {
    w,
    task,
    steps,
    async input() {
      const i = await w.input(NOW);
      const base = Date.parse("2026-11-01T00:00:00.000Z");
      const events = i.events.map((e) => ({ ...e, ts: stamped.get(e.seq) ?? new Date(base + e.seq * 60_000).toISOString() }));
      const tasks = i.orca.tasks.map((t) => ({ ...t, title: TITLES[t.id] ?? w.tasks.get(t.id)?.title ?? t.id }));
      return { events, now: NOW, orca: { ...i.orca, tasks, gates: [] } };
    },
  };
}
