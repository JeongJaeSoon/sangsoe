import assert from "node:assert/strict";
import { test } from "node:test";
import { doneBlockers, expandFlow, loadFlow, parseFlow, parseToml, planFlow, ready, why } from "../../core/index.ts";
import { ownerSays } from "../decision/world.ts";
import { createGraphWorld, type GraphWorld } from "./world.ts";

const RUN = "run_a";
const plan = (name: string, vars: Record<string, string>) => {
  const p = planFlow(loadFlow(name), vars);
  assert.ok(p.ok, JSON.stringify(p));
  return p.value;
};
const expand = async (w: GraphWorld, name: string, vars: Record<string, string>, requestId = "req-1") => {
  const r = await expandFlow(w, { plan: plan(name, vars), run: RUN, who: "lead:api", requestId });
  assert.ok(r.ok, JSON.stringify(r));
  return r.value;
};
const readyIds = async (w: GraphWorld) => ready(await w.input()).map((r) => r.task);
const prOpened = (w: GraphWorld, pr: string, task: string) => w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr, task } });
const prMerged = (w: GraphWorld, pr: string) => w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr, merge_sha: "abc1234" } });
const stage = (w: GraphWorld, pr: string, s: "merge" | "dev" | "prod") => w.store.append({ type: "stage_recorded", source: "lead:api", payload: { pr, stage: s, sha: "abc1234" } });

test("the TOML subset reads the templates and refuses what it does not know, with the line", () => {
  assert.deepEqual(parseToml('a = "x" # c\n[t.u]\nb = [1, true, { k = "v" }]\n[[s]]\nid = "p"\n[[s]]\nid = "q"'), {
    a: "x",
    t: { u: { b: [1, true, { k: "v" }] } },
    s: [{ id: "p" }, { id: "q" }],
  });
  assert.throws(() => parseToml('a = """x"""'), /line 1: multi-line strings/);
  assert.throws(() => parseToml("a.b = 1"), /line 1: dotted keys/);
  assert.throws(() => parseToml("a = 1\na = 2"), /line 2: duplicate key a/);
  assert.throws(() => parseToml("a = 2026-11-10"), /line 1: unsupported value/);
});

test("a template is checked: unknown need, cycle, owner gate without why_owner", () => {
  const head = 'name = "x"\nversion = 1\n';
  assert.throws(() => parseFlow(`${head}[[steps]]\nid = "a"\ndone_when = "d"\nneeds = [{ step = "zz", kind = "blocks" }]`), /needs unknown step zz/);
  assert.throws(
    () => parseFlow(`${head}[[steps]]\nid = "a"\ndone_when = "d"\nneeds = [{ step = "b", kind = "after" }]\n[[steps]]\nid = "b"\ndone_when = "d"\nneeds = [{ step = "a", kind = "blocks" }]`),
    /cycle among a, b/,
  );
  assert.throws(() => parseFlow(`${head}[[steps]]\nid = "a"\ndone_when = "d"\ngate = "owner"`), /owner gate has who/);
  assert.throws(() => parseFlow(`${head}[[steps]]\nid = "a"\ndone_when = "d"\nneeds = [{ step = "a", kind = "sometimes" }]`), /kind: one of/);
});

test("--dry-run plans items and edges without writing; vars are checked", async () => {
  const w = createGraphWorld();
  const p = plan("ship-change", { repo: "acme/api" });
  assert.deepEqual(
    p.steps.map((s) => [s.id, s.depSteps, s.edges.map((e) => `${e.step}:${e.kind}`), s.execBy ?? "-"]),
    [
      ["impl", [], [], "-"],
      ["review", ["impl"], [], "-"],
      ["merge", ["review"], [], "-"],
      ["deploy_dev", [], ["merge:deploys_after"], "-"],
      ["verify_dev", ["deploy_dev"], [], "-"],
      ["deploy_prod", ["verify_dev"], ["deploy_dev:deploys_after"], "owner"],
    ],
  );
  assert.equal(p.steps[0]?.title, "구현 acme/api");
  assert.equal(w.store.events().length, 0);
  assert.equal(w.tasks.size, 0);
  const missing = planFlow(loadFlow("ship-change"), {});
  assert.ok(!missing.ok && missing.refusal.reason === "var repo is required");
  const extra = planFlow(loadFlow("ship-change"), { repo: "acme/api", nope: "1" });
  assert.ok(!extra.ok && /unknown var/.test(extra.refusal.reason));
});

test("expand makes the root and every step in one pass, blocks as Orca deps, and resumes by request id", async () => {
  const w = createGraphWorld();
  const e = await expand(w, "ship-change", { repo: "acme/api" });
  assert.equal(Object.keys(e.steps).length, 6);
  const t = (id: string) => w.tasks.get(e.steps[id] as string);
  assert.deepEqual(t("review")?.deps, [e.steps.impl]);
  assert.deepEqual(t("deploy_prod")?.deps, [e.steps.verify_dev]);
  assert.equal(t("impl")?.parent, e.root);
  const edges = w.store.events({ type: "edge_added" }).map((x) => [x.payload.pred, x.payload.succ, x.payload.kind]);
  assert.deepEqual(edges, [
    [`item:${e.steps.merge}`, `item:${e.steps.deploy_dev}`, "deploys_after"],
    [`item:${e.steps.deploy_dev}`, `item:${e.steps.deploy_prod}`, "deploys_after"],
  ]);
  assert.equal(w.store.events({ type: "flow_expanded" }).length, 1);
  const again = await expand(w, "ship-change", { repo: "acme/api" });
  assert.deepEqual([again.root, again.steps, again.resumed], [e.root, e.steps, true]);
  assert.equal(w.tasks.size, 7, "a re-run with the same request id makes nothing new");
});

test("prod_gate: prod waits for the dev check and the dev stage record, and only the owner may mark it done", async () => {
  const w = createGraphWorld();
  const e = await expand(w, "ship-change", { repo: "acme/api" });
  const s = e.steps as Record<string, string>;
  prOpened(w, "acme/api#7", s.impl as string);
  for (const id of ["impl", "review"]) w.complete(s[id] as string);
  prMerged(w, "acme/api#7");
  assert.ok(!(await readyIds(w)).includes(s.deploy_dev as string), "merged, but no merge stage record yet");
  stage(w, "acme/api#7", "merge");
  w.complete(s.merge as string);
  assert.ok((await readyIds(w)).includes(s.deploy_dev as string));
  w.complete(s.deploy_dev as string);
  stage(w, "acme/api#7", "dev");

  const before = why(await w.input(), s.deploy_prod as string);
  assert.equal(before.readiness, "waiting", "no dev check evidence: prod is 📅");
  assert.deepEqual(before.rows.map((r) => [r.kind, r.predState]), [["blocks", "📅 예정"]]);

  w.complete(s.verify_dev as string);
  const after = why(await w.input(), s.deploy_prod as string);
  assert.equal(after.readiness, "owner_ready", "🟢 for the owner");
  assert.ok(!(await readyIds(w)).includes(s.deploy_prod as string), "not on a lead's start list");
  assert.deepEqual(doneBlockers(await w.input(), s.deploy_prod as string), ["owner_gate: 오너만 ✅ 로 쓴다(owner_action 근거가 필요하다)"]);
  assert.equal(doneBlockers(await w.input(), s.deploy_prod as string, { owner: true, ownerAction: 999 }).length, 1, "an owner_action that does not exist is no ground");
  const act = ownerSays(w.store, "prod 반영했다");
  assert.deepEqual(doneBlockers(await w.input(), s.deploy_prod as string, { owner: true, ownerAction: act }), []);
});

test("early_done: the flow item cannot be ✅ while a PR in scope is open; merged or cancelled-with-reason releases it", async () => {
  const w = createGraphWorld();
  const e = await expand(w, "ship-change", { repo: "acme/api" });
  const s = e.steps as Record<string, string>;
  prOpened(w, "acme/api#8", s.impl as string);
  for (const id of Object.values(s)) w.complete(id);
  const blockers = doneBlockers(await w.input(), e.root);
  assert.deepEqual(blockers, ["open_pr: acme/api#8"]);
  prMerged(w, "acme/api#8");
  assert.deepEqual(doneBlockers(await w.input(), e.root), []);

  const v = createGraphWorld();
  const f = await expand(v, "ship-change", { repo: "acme/api" }, "req-2");
  const t = f.steps as Record<string, string>;
  v.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#9", task: t.impl as string } });
  v.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#9" } });
  for (const id of Object.values(t)) if (id !== t.impl) v.complete(id);
  assert.ok(doneBlockers(await v.input(), f.root).some((b) => b.startsWith("closed_pr: acme/api#9")));
  v.cancel(t.impl as string);
  assert.deepEqual(doneBlockers(await v.input(), f.root), []);
});

test("flow_gap: an expansion cut short refuses ✅ until resumed, or until the missing steps are skipped with a reason", async () => {
  const w = createGraphWorld();
  const p = plan("ship-change", { repo: "acme/api" });
  w.failCreateAfter(6);
  const cut = await expandFlow(w, { plan: p, run: RUN, who: "lead:api", requestId: "req-gap" });
  assert.ok(!cut.ok && cut.refusal.code === "task_create_failed" && cut.refusal.reason.startsWith("step deploy_prod"));
  const root = [...w.tasks.values()].find((t) => t.parent === null)?.id as string;
  for (const t of w.tasks.values()) if (t.parent === root) w.complete(t.id);
  assert.deepEqual(doneBlockers(await w.input(), root), ["flow_gap: deploy_prod"]);

  w.store.append({ type: "flow_step_skipped", source: "lead:api", subject: `item:${root}`, payload: { step: "deploy_prod", reason: "internal tool, no prod" } });
  assert.deepEqual(doneBlockers(await w.input(), root), []);

  const v = createGraphWorld();
  v.failCreateAfter(3);
  await expandFlow(v, { plan: p, run: RUN, who: "lead:api", requestId: "req-gap" });
  v.failCreateAfter(null);
  const resumed = await expandFlow(v, { plan: p, run: RUN, who: "lead:api", requestId: "req-gap" });
  assert.ok(resumed.ok && resumed.value.resumed);
  assert.equal(v.tasks.size, 7);
  assert.equal(v.store.events({ type: "flow_expanded" }).length, 1);
});

test("ship-batch: deploy_dev waits on every member with Orca deps", async () => {
  const w = createGraphWorld();
  w.task("t_m1", RUN);
  w.task("t_m2", RUN);
  const e = await expand(w, "ship-batch", { repo: "acme/api", members: "t_m1, t_m2" });
  const dev = e.steps.deploy_dev as string;
  assert.deepEqual(w.tasks.get(dev)?.deps, ["t_m1", "t_m2"]);
  w.complete("t_m1");
  assert.ok(!(await readyIds(w)).includes(dev));
  w.complete("t_m2");
  assert.ok((await readyIds(w)).includes(dev));
});
