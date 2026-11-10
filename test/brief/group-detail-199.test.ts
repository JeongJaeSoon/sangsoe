import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, buildGroup, type GroupDetail, graphRead, type Table } from "../../core/index.ts";
import { type GroupWorld, groupWorld } from "./group-world.ts";

// Decision 199: stage 2 carries every part of hallmark-final group.html, counted once in the core.

let world: GroupWorld;
let m: GroupDetail;
const text = (tb: Table) => tb.rows.map((r) => r.cells.map((c) => c.text));
const col = (tb: Table, i: number) => tb.rows.map((r) => r.cells[i]?.text);

test.before(async () => {
  world = await groupWorld();
  const g = buildGroup(await world.input(), "api-migration");
  assert.ok(g);
  m = g;
});

test("summary tiles: 진행 + 막힘 + 남은 것 is the header's N건, and 7일 is the folded rows' count", () => {
  const f = m.figures;
  assert.equal(f.doing + f.blocked + f.left, m.items);
  assert.equal(f.blocked, m.blockedCount);
  assert.equal(f.planned + f.ready + f.onHold, f.left);
  assert.deepEqual([f.doing, f.blocked, f.ready, f.flags], [1, 2, 2, 1]);
  assert.equal(f.done, m.done.rows.length);
  assert.equal(f.doneDays, 7);
});

test("완료 최근 7일: rows newest first with the merged PR; an older close stays out", () => {
  assert.deepEqual(col(m.done, 0), ["i024 인덱스 추가", "i021 읽기 전용 모드"]);
  assert.deepEqual(col(m.done, 1), ["acme/api#38", "acme/api#35"]);
  assert.ok(!m.done.rows.some((r) => r.id === "i020"), "i020 closed 10-20, outside the window");
});

test("현황 carries the same 완료 rows as its ✅ count", async () => {
  const o = buildBrief(await world.input());
  assert.equal(o.done.rows.length, o.summary.done);
  assert.deepEqual(
    o.done.rows.map((r) => r.id),
    ["i024", "i021"],
  );
});

test("DAG nodes: every item an edge touches, with title and state; a PR predecessor is no node", () => {
  const ids = m.nodes.map((n) => n.id);
  assert.ok(ids.includes("i026") && ids.includes("i027"));
  assert.ok(!ids.some((id) => id.includes("#")), "pr:acme/api#77 is a reference, not a box");
  const n26 = m.nodes.find((n) => n.id === "i026");
  assert.deepEqual([n26?.title, n26?.state, n26?.flags, n26?.outside], ["N+1 쿼리 제거", "🔄", "🚨", null]);
  assert.equal(m.nodes.find((n) => n.id === "i052")?.outside, "docs");
});

test("broken is the dangling predecessor only; an open PR predecessor is a reference", () => {
  assert.deepEqual(m.brokenEdges, ["i027>i043:blocks"]);
  const ref = m.edges.find((e) => e.pred === "pr:acme/api#77");
  assert.equal(ref?.met, null);
  assert.deepEqual(text(m.broken), [["i043", "i027 캐시 도입 🗑️ 취소 (blocks)", "리드: 간선을 빼거나(이유 필수) 후속을 취소한다"]]);
  assert.ok(m.broken.rows.every((r) => r.broken));
});

test("critical path rows carry 상태 and 단계 이름 (the flow step, the owner gate)", () => {
  assert.deepEqual(col(m.critical, 0), ["1", "2", "3", "4"]);
  assert.deepEqual(col(m.critical, 2), ["🔄 진행 중", "📅 예정", "📅 예정", "📅 예정"]);
  assert.deepEqual(col(m.critical, 3), ["지금 늦추는 것", "deploy_dev", "verify_dev", "deploy_prod, 오너 게이트"]);
  assert.deepEqual(m.criticalPath, m.critical.rows.map((r) => r.id));
});

test("stacked PR chain: floors follow stacked_on from the bottom PR", () => {
  assert.deepEqual(text(m.stack), [
    ["1층", "acme/api#40", "i026 N+1 쿼리 제거", "🔄 진행 중"],
    ["2층", "acme/api#42", "i038 N+1 후속 정리 PR", "📅 예정"],
    ["3층", "acme/api#43", "i043 후속 테스트 PR", "📅 예정"],
  ]);
});

test("release bundle: the expanded ship-batch's merge row from deploy_dev's members, then each step's condition", () => {
  assert.equal(m.release.length, 1);
  const r = m.release[0] as Table;
  assert.match(r.title, /^릴리스 묶음 ship-batch/);
  assert.deepEqual(col(r, 0), ["머지", "deploy_dev", "verify_dev", "deploy_prod"]);
  assert.equal(r.rows[0]?.cells[1]?.text, "구성원 2건이 모두 머지");
  assert.match(r.rows[0]?.cells[2]?.text ?? "", /i031 🚧 acme\/api#31, i026 🔄 acme\/api#40/);
  assert.match(r.rows[3]?.cells[1]?.text ?? "", /verify_dev 완료 뒤, deploy_dev 단계 기록 뒤.*오너 게이트/);
  assert.equal(r.rows[1]?.cells[2]?.text, `${world.steps.deploy_dev} 📅`);
});

test("간선 N lists every edge once with its note", () => {
  assert.equal(m.edgeList.count, m.edges.length);
  const note = (pred: string, succ: string) => m.edgeList.rows.find((r) => r.id.startsWith(`${pred}>${succ}:`))?.cells[3]?.text;
  assert.equal(note("i026", world.steps.deploy_dev as string), "크리티컬 패스 1에서 2");
  assert.equal(note("i027", "i043"), "끊긴 선행");
  assert.equal(note("pr:acme/api#77", "i038"), "그림 밖 선행");
  assert.equal(note("i052", world.steps.deploy_prod as string), "외부 선행 docs");
  assert.ok(m.edgeList.rows.find((r) => r.id === "i027>i043:blocks")?.broken);
});

test("왜 준비되지 않았나 keeps after and stacked_on rows built through the writers, and flags the dangling one", async () => {
  const input = await world.input();
  assert.deepEqual(
    graphRead.why(input, world.task.i038 as string).map((e) => e.kind),
    ["stacked_on", "after"],
  );
  const rows = text(m.why);
  assert.ok(rows.some((r) => r[0] === "i038" && r[2] === "after" && r[3] === "열림"), "a PR predecessor reads GRAPH's 선행 상태");
  assert.ok(rows.some((r) => r[0] === "i043" && r[2] === "stacked_on"));
  assert.ok(m.why.rows.some((r) => r.broken && r.cells[1]?.text === "i027"));
});

test("최근 전환: the group's latest five transitions, newest first", () => {
  assert.equal(m.recent.rows.length, 5);
  assert.match(m.recent.rows[0]?.cells[1]?.text ?? "", /^i026 /);
  assert.match(m.recent.rows[0]?.cells[2]?.text ?? "", /🟢 준비됨 → 🔄 진행 중 worker-start/);
  assert.ok(!m.recent.rows.some((r) => r.cells[1]?.text.startsWith("i052")), "another group's item is not listed");
});
