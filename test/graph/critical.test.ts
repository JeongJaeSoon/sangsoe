import assert from "node:assert/strict";
import { test } from "node:test";
import { addEdgeTo, criticalPath, type GraphRead, graphRead, impact } from "../../core/index.ts";

// U9's brief takes this port; the assignment fails typecheck if graphRead drifts from it.
const asBriefPort: GraphRead = graphRead;
import { bindItem, createGraphWorld } from "./world.ts";

// An independent longest path for the cross-check (decision 29): enumerate every path by DFS. It
// shares no code with core/graph/critical.ts.
function bruteLongest(nodes: string[], edges: [string, string][], w: (n: string) => number): number {
  const out = new Map<string, string[]>();
  for (const [a, b] of edges) out.set(a, [...(out.get(a) ?? []), b]);
  const walk = (n: string): number => w(n) + Math.max(0, ...(out.get(n) ?? []).map(walk));
  return Math.max(0, ...nodes.map(walk));
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("critical path matches a brute-force longest path on 60 random DAGs, Orca deps and extra edges mixed", async () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed);
    const w = createGraphWorld();
    const n = 2 + Math.floor(r() * 9);
    const ids = Array.from({ length: n }, (_, i) => `t${String(i).padStart(2, "0")}`);
    const edges: [string, string][] = [];
    const est = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const deps = ids.slice(0, i).filter(() => r() < 0.25);
      const id = ids[i] as string;
      w.task(id, "run_a", deps);
      for (const d of deps) edges.push([d, id]);
      const withEst = r() < 0.5;
      if (withEst) est.set(id, 1 + Math.floor(r() * 5));
      bindItem(w, id, `i${String(100 + i)}`, withEst ? { est: String(est.get(id)), lead: "lead:a" } : { lead: "lead:a" });
    }
    const snap = await w.snapshot();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (r() < 0.12 && !edges.some(([a, b]) => a === ids[i] && b === ids[j])) {
          const add = addEdgeTo(w, snap, { pred: `item:${ids[i]}`, succ: `item:${ids[j]}`, kind: "after" });
          assert.ok(add.ok);
          edges.push([ids[i] as string, ids[j] as string]);
        }
      }
    }
    const got = criticalPath(await w.input(), "lead:a");
    const weight = (x: string) => est.get(x) ?? 1;
    assert.equal(got.length, bruteLongest(ids, edges, weight), `seed ${seed}`);
    const path = got.path.map((p) => p.task);
    assert.equal(path.reduce((s, x) => s + weight(x), 0), got.length, `seed ${seed}: the path weighs its length`);
    for (let k = 1; k < path.length; k++) {
      assert.ok(edges.some(([a, b]) => a === path[k - 1] && b === path[k]), `seed ${seed}: ${path[k - 1]} → ${path[k]} is an edge`);
    }
    assert.equal(got.estimated, path.some((x) => est.has(x)));
    assert.equal(got.slowest?.task, path[0]);
  }
});

test("critical path: finished items drop out, ties go to the earlier item, another group's predecessor is external", async () => {
  const w = createGraphWorld();
  w.task("t_done", "run_a");
  w.task("t_x", "run_a", ["t_done"]);
  w.task("t_y", "run_a");
  w.task("t_ext", "run_b");
  w.task("t_z", "run_a");
  bindItem(w, "t_done", "i001", { lead: "lead:a" });
  bindItem(w, "t_x", "i002", { lead: "lead:a" });
  bindItem(w, "t_y", "i003", { lead: "lead:a" });
  bindItem(w, "t_ext", "i004", { lead: "lead:b" });
  bindItem(w, "t_z", "i005", { lead: "lead:a" });
  w.complete("t_done");
  const snap = await w.snapshot();
  assert.ok(addEdgeTo(w, snap, { pred: "i004", succ: "i005", kind: "blocks" }).ok);
  const c = criticalPath(await w.input(), "lead:a");
  assert.deepEqual(c.path.map((p) => [p.item, p.externalGroup ?? null]), [["i004", "lead:b"], ["i005", null]]);
  assert.equal(c.length, 2);
  assert.equal(c.estimated, false, "no est anywhere: a step count, not an estimate");

  const tie = createGraphWorld();
  tie.task("t_1", "run_a");
  tie.task("t_2", "run_a");
  bindItem(tie, "t_1", "i001");
  bindItem(tie, "t_2", "i002");
  assert.deepEqual(criticalPath(await tie.input()).path.map((p) => p.item), ["i001"]);
});

test("graphRead (brief's port): edges from both homes in task ids, a critical path over given tasks, unmet preds", async () => {
  const w = createGraphWorld();
  w.task("t_a", "run_a");
  w.task("t_b", "run_a", ["t_a"]);
  w.task("t_c", "run_a");
  assert.ok(addEdgeTo(w, await w.snapshot(), { pred: "item:t_b", succ: "item:t_c", kind: "after" }).ok);
  const input = await w.input();
  assert.deepEqual(graphRead.edges(input), [
    { pred: "t_a", succ: "t_b", kind: "blocks" },
    { pred: "t_b", succ: "t_c", kind: "after" },
  ]);
  assert.deepEqual(graphRead.criticalPath(input, ["t_a", "t_b", "t_c"]), ["t_a", "t_b", "t_c"]);
  assert.deepEqual(graphRead.criticalPath(input, []), []);
  assert.deepEqual(graphRead.why(input, "t_c"), [{ pred: "t_b", succ: "t_c", kind: "after" }]);
  assert.deepEqual(asBriefPort.ready(input).map((r) => r.task), ["t_a"]);
});

test("impact lists unfinished successors nearest first, with group and priority", async () => {
  const w = createGraphWorld();
  w.task("t_a", "run_a");
  w.task("t_b", "run_a", ["t_a"]);
  w.task("t_c", "run_b");
  w.task("t_d", "run_a", ["t_b"]);
  bindItem(w, "t_a", "i001", { lead: "lead:a" });
  bindItem(w, "t_b", "i002", { lead: "lead:a", priority: "P1" });
  bindItem(w, "t_c", "i003", { lead: "lead:b" });
  bindItem(w, "t_d", "i004", { lead: "lead:a" });
  assert.ok(addEdgeTo(w, await w.snapshot(), { pred: "i002", succ: "i003", kind: "after" }).ok);
  assert.deepEqual(
    impact(await w.input(), "i001").map((r) => [r.item, r.distance, r.lead, r.priority]),
    [
      ["i002", 1, "lead:a", "P1"],
      ["i003", 2, "lead:b", "P2"],
      ["i004", 2, "lead:a", "P2"],
    ],
  );
});
