import assert from "node:assert/strict";
import { test } from "node:test";
import { type MonitorReport, prCursor, runMonitor, WALK_BUDGET_MS } from "../../core/index.ts";
import { CAP_MS, type FleetOptions, fleet } from "./pr-fleet.ts";

/** A fleet whose rounds share one runner's cursor, each under the timer's 90 s cap. */
function runner(o: FleetOptions = {}) {
  const f = fleet(o);
  const cursor = prCursor();
  const round = async () => {
    const cap = f.capped();
    const from = f.charges.length;
    const r = await runMonitor("pr", { ...f.deps, prCursor: cursor }, cap.signal);
    cap.done();
    return { r, ms: f.now() - cap.start, from };
  };
  return { f, cursor, round };
}

const truncation = (r: MonitorReport) => r.planned.find((e) => e.type === "monitor_round_truncated")?.payload as
  | { repos_done: number; repos_left: number; elapsed_ms: number }
  | undefined;

test("329: eleven repositories on a slow gh, one round under the 90 s cap writes what it found", async () => {
  const f = fleet();
  const cap = f.capped();
  // The plugin's runner, which keeps a cursor between rounds.
  const r = await runMonitor("pr", { ...f.deps, prCursor: prCursor() }, cap.signal);
  cap.done();
  assert.ok(r.written.length > 0, `the round wrote nothing (aborted ${r.aborted}, ${f.now() - cap.start} ms)`);
  assert.ok(
    f.rows("pr_opened").some((e) => e.payload.pr === "acme/app-01#900"),
    "the first repository's tracked PR is recorded",
  );
  assert.equal(r.aborted, false, "the walk stops at its own budget, before the cap");
  const cut = truncation(r);
  assert.ok(cut, "a round that stopped with repositories left says so");
  assert.equal(cut.repos_done + cut.repos_left, 11);
  assert.ok(cut.repos_left > 0);
  assert.ok(cut.elapsed_ms >= WALK_BUDGET_MS && cut.elapsed_ms < CAP_MS, `elapsed ${cut.elapsed_ms}`);
  assert.equal(f.rows("monitor_round_truncated").length, 1);
});

test("329: a cold start converges — every repository is read through within a few rounds, then rounds are short", async () => {
  const { f, round } = runner();
  const seen = new Set<string>();
  let rounds = 0;
  for (; rounds < 8; rounds++) {
    const { r, ms } = await round();
    assert.equal(r.aborted, false, `round ${rounds + 1} hit the cap after ${ms} ms`);
    for (const e of f.rows("pr_opened")) seen.add(String(e.payload.pr));
    if (!truncation(r)) break;
  }
  assert.ok(rounds < 8, "the walk never finished");
  assert.deepEqual([...seen].sort(), ["acme/app-01#900", "acme/app-11#900"]);

  const steady = await round();
  assert.equal(truncation(steady.r), undefined);
  assert.equal(f.calls("reference find", steady.from), 2, "only the two tracked open PRs are looked up again");
  assert.equal(f.calls("worktree list", steady.from), 1, "one worktree list per round");
  assert.ok(steady.ms < 30_000, `a settled round took ${steady.ms} ms`);
});

test("329: a PR that changes is read again; one whose reference find fails is never settled", async () => {
  const { f, round } = runner({ repos: 1, trackedIn: [] });
  const merged = f.routes.get("repos/acme/app-01/pulls?state=closed&sort=updated&direction=desc&per_page=30") as { number: number; updated_at: string }[];
  const lost = merged[3] as { number: number; updated_at: string };
  f.unreadable.add(f.url("acme/app-01", lost.number));
  await round();
  const again = await round();
  assert.equal(f.calls("reference find", again.from), 1, "only the unreadable PR");
  const touched = merged[7] as { number: number; updated_at: string };
  touched.updated_at = "2026-11-17T11:59:00Z";
  const third = await round();
  assert.equal(f.calls("reference find", third.from), 2, "the unreadable PR and the one updated since");
});

test("329: a PR list without updated_at is never skipped", async () => {
  const { f, round } = runner({ repos: 1, trackedIn: [], open: 0 });
  const path = "repos/acme/app-01/pulls?state=closed&sort=updated&direction=desc&per_page=30";
  for (const p of f.routes.get(path) as Record<string, unknown>[]) delete p.updated_at;
  await round();
  const again = await round();
  assert.equal(f.calls("reference find", again.from), 30);
});

test("329: a repository whose tracked PRs alone outrun its share still reaches its tail, and no other starves", async () => {
  const { f, cursor, round } = runner({ trackedIn: [0], tracked: 25 });
  const finished = new Set<string>();
  let rounds = 0;
  for (; rounds < 12; rounds++) {
    const { r } = await round();
    assert.equal(r.aborted, false);
    for (const repo of f.repos) if (!cursor.left.includes(repo)) finished.add(repo);
    if (!truncation(r)) break;
  }
  assert.ok(rounds < 12, `still truncated after ${rounds} rounds; left ${cursor.left.join(", ")}`);
  assert.deepEqual([...finished].sort(), f.repos, "every repository finished its walk at least once");
  assert.equal(f.rows("pr_opened").filter((e) => String(e.payload.pr).startsWith("acme/app-01#")).length, 25);
  assert.ok(cursor.settled.has("acme/app-01#129"), "the last merged PR of the busy repository was reached");
});

test("329: when one PR outlasts the whole budget, each round starts at a repository the last one never reached", async () => {
  const f = fleet({ orcaMs: 61_000 });
  const cursor = prCursor();
  const firsts: string[] = [];
  for (let i = 0; i < 11; i++) {
    const from = f.charges.length;
    await runMonitor("pr", { ...f.deps, prCursor: cursor });
    firsts.push(f.charges[from]?.repo ?? "");
  }
  assert.deepEqual(firsts, f.repos);
});

test("329: a round the cap cuts still writes the PR it judged with no Orca write, and the truncation", async () => {
  // One Orca call outlasts the whole cap: the cap fires inside the first PR.
  const f = fleet({ orcaMs: 100_000 });
  const cap = f.capped();
  const r = await runMonitor("pr", { ...f.deps, prCursor: prCursor() }, cap.signal);
  cap.done();
  assert.equal(r.aborted, true);
  assert.ok(f.rows("pr_opened").some((e) => e.payload.pr === "acme/app-01#900"), "the judged PR is written past the cap");
  const cut = f.rows("monitor_round_truncated")[0]?.payload;
  assert.deepEqual({ done: cut?.repos_done, left: cut?.repos_left }, { done: 0, left: 11 });
});

test("329: past the cap a PR's Orca write waits for the next round, which starts at that PR", async () => {
  const f = fleet({ orcaMs: 100_000 });
  // No Orca link, a workspace on its branch: the round adds the reference.
  f.refs.delete(f.url("acme/app-01", 900));
  const cursor = prCursor();
  const cap = f.capped();
  const r = await runMonitor("pr", { ...f.deps, prCursor: cursor }, cap.signal);
  cap.done();
  assert.equal(r.aborted, true);
  assert.deepEqual(r.acts.map((a) => a.ok), [null], "the act is listed, not run");
  assert.ok(f.rows("pr_opened").some((e) => e.payload.pr === "acme/app-01#900"), "the event it gates nothing for is written");
  assert.equal(f.calls("reference add"), 0);
  assert.equal(f.rows("monitor_round_truncated").length, 1);
  assert.equal(cursor.resume.get("acme/app-01"), "acme/app-01#900");

  f.delays({ orcaMs: 700 });
  const next = f.capped();
  await runMonitor("pr", { ...f.deps, prCursor: cursor }, next.signal);
  next.done();
  assert.equal(f.charges.find((c) => c.stage === "reference add")?.repo, "acme/app-01");
});

test("329: a settled open PR is read again once a land names it", async () => {
  const { f, round } = runner({ repos: 1, trackedIn: [], merged: 0 });
  await round();
  const quiet = await round();
  assert.equal(f.calls("reference find", quiet.from), 0, "the five untracked open PRs are settled");
  f.store.append({ type: "land_requested", source: "land", payload: { pr: "acme/app-01#502", head_sha: "0".repeat(40), reason: "merge_on_approval" } });
  const after = await round();
  assert.equal(f.calls("reference find", after.from), 1);
});

test("329: the cursor is not trusted while a lost database waits for its reread", async () => {
  const { f, cursor, round } = runner({ repos: 1, trackedIn: [] });
  await round();
  assert.ok(cursor.settled.size > 0);
  f.store.append({ type: "signal", source: "store", payload: { kind: "store_rebuilt" } });
  const after = await round();
  assert.equal(f.calls("reference find", after.from), 35, "every PR is looked up again");
});

test("329: a reread starts each repository from its first PR, not where a cut walk stopped", async () => {
  const { f, cursor, round } = runner();
  await round();
  assert.ok(cursor.resume.has("acme/app-01"), "the first round left app-01 mid-walk");
  const asked: string[] = [];
  const referenceFind = async (a: { query: string; limit?: number }) => {
    asked.push(a.query);
    return f.deps.orca.referenceFind(a);
  };
  const orca = { ...f.deps.orca, referenceFind };
  f.store.append({ type: "signal", source: "store", payload: { kind: "store_rebuilt" } });
  await runMonitor("pr", { ...f.deps, orca: orca as typeof f.deps.orca, prCursor: cursor });
  assert.equal(asked[0], f.url("acme/app-01", 900));
});

test("329: main CI is still read on a round whose walk was cut", async () => {
  const { f, round } = runner();
  f.store.append({ type: "pr_merged", source: "pr-monitor", dedupe_key: "pr_merged:acme%2Fapp-05#120", payload: { pr: "acme/app-05#120", merge_sha: "c".repeat(40), merged_at: "2026-11-17T11:00:00Z" } });
  const { r, from } = await round();
  assert.ok(truncation(r));
  assert.equal(f.calls("main CI", from), 1);
});

test("329: a one-shot round (the CLI, no cursor and no cap) reads every repository through and is not cut", async () => {
  const f = fleet();
  const r = await runMonitor("pr", f.deps);
  assert.equal(truncation(r), undefined);
  assert.deepEqual(f.rows("pr_opened").map((e) => e.payload.pr), ["acme/app-01#900", "acme/app-11#900"]);
  assert.equal(f.calls("reference find"), 11 * 35 + 2);
});

test("329: a dry run lists what the round would write, and writes nothing", async () => {
  const f = fleet();
  const { append: _, ...dry } = f.deps;
  const cap = f.capped();
  const r = await runMonitor("pr", { ...dry, prCursor: prCursor() }, cap.signal);
  cap.done();
  assert.ok(r.planned.some((e) => e.type === "pr_opened"));
  assert.ok(truncation(r));
  assert.deepEqual(r.written, []);
  assert.equal(f.rows().length, 0);
});
