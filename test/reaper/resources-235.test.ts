// Decision 235: the 리소스 read asks GitHub and Orca only about sangsoe's own cards, comes in three
// parts the panel can paint one by one, and draws the load band from rows the store already has.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  dedupeKey,
  type EventDef,
  eventDef,
  type Exec,
  loadBand,
  type ReapOptions,
  type ReapReport,
  readResourcePart,
  readResources,
  type ResourceDeps,
  Store,
  type WorktreeRow,
} from "../../core/index.ts";
import { scratchDir } from "../scratch.ts";
import { card, dropScratch, finishedCard, makeRepo, startedBySangsoe, worker, world } from "./harness.ts";

after(dropScratch);

test("only: a dry run judges sangsoe's cards exactly as the whole round would, and asks about no other card", async () => {
  const w = world();
  w.dryRun = true;
  const mine = finishedCard(w, "mine-done");
  const mineSmoke = card("mine-smoke", makeRepo("mine-smoke"));
  w.orca.cards.push(mineSmoke);
  startedBySangsoe(w, mineSmoke);
  const mineOpen = finishedCard(w, "mine-open");
  w.gh.prs.push({ number: 50, state: "open", merged_at: null, head: { sha: "a".repeat(40), ref: "mine-open" } });
  const theirs = finishedCard(w, "theirs-done", { foreign: true });
  w.orca.workers.push(worker(theirs.id, { dispatchId: "ctx_theirs" }));
  const otherRepo = finishedCard(w, "other-repo", { foreign: true, projectId: "github:other/thing" });

  const whole = await w.round({ explain: true });
  const ghWhole = w.gh.paths.length;
  w.gh.paths = [];
  w.orca.calls = [];
  const ids = new Set([mine, mineSmoke, mineOpen].map((c) => c.instanceId ?? ""));
  const only = await w.round({ explain: true, only: ids });

  const pick = (r: ReapReport) => r.judged.filter((j) => ids.has(j.ref)).sort((a, b) => a.ref.localeCompare(b.ref));
  assert.deepEqual(pick(only), pick(whole), "the same verdict for every sangsoe card");
  assert.ok(pick(whole).length >= 2, "the fixture has candidates to compare");
  assert.equal(only.roots_ok, whole.roots_ok);
  assert.deepEqual(only.judged.map((j) => j.ref).filter((r) => !ids.has(r)), [], "no other card is judged");
  for (const c of [theirs, otherRepo]) {
    assert.ok(!w.gh.paths.some((p) => p.includes(c.displayName ?? "-")), `no GitHub lookup for ${c.displayName}`);
  }
  assert.ok(!w.gh.paths.some((p) => p.includes("other/thing")), "no open-PR page of a repository with no sangsoe card");
  assert.ok(!w.orca.calls.some((c) => c.includes("ctx_theirs")), "no Orca read of another program's Dispatch");
  assert.ok(w.gh.paths.length < ghWhole, `${w.gh.paths.length} GitHub calls, not ${ghWhole}`);
});

test("only narrows a dry run alone: a round that writes ignores it", async () => {
  const w = world();
  const a = finishedCard(w, "narrow-a");
  const b = finishedCard(w, "narrow-b");
  const r = await w.round({ only: new Set([a.instanceId ?? ""]) });
  assert.deepEqual(r.candidates.sort(), [a.instanceId, b.instanceId].sort());
});

const NOW = Date.parse("2026-11-14T12:00:00Z");
const H = 3_600_000;

function deps(o: { plan?: (opts: ReapOptions) => Promise<ReapReport>; store?: Store; cards?: WorktreeRow[] } = {}): ResourceDeps & { asked: string[] } {
  const store = o.store ?? Store.open({ path: ":memory:" });
  const asked: string[] = [];
  const exec: Exec = async (file, args) => {
    asked.push(file);
    if (file === "du") return { code: 0, stdout: args.slice(1).map((p) => `8\t${p}`).join("\n"), stderr: "" };
    if (file === "ps") return { code: 0, stdout: " 100 claude\n", stderr: "" };
    throw new Error(`unexpected ${file}`);
  };
  const cards = o.cards ?? [];
  return {
    asked,
    orca: {
      worktreeList: async () => {
        asked.push("worktreeList");
        return { ok: true, value: { rows: cards, nonLocal: { rows: 0, hostIds: [], ids: [] }, omittedHostIds: [], truncated: false } };
      },
      worktreePs: async () => {
        asked.push("worktreePs");
        return { ok: true, value: { rows: [], nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false } };
      },
      diagnosticsMemory: async () => {
        asked.push("diagnosticsMemory");
        return { ok: true, value: { host: { availableMemory: 25, totalMemory: 100 } } };
      },
    } as unknown as ResourceDeps["orca"],
    exec,
    events: (f) => store.events(f),
    now: () => NOW,
    sample: () => ({ load5: 4, cpus: 8 }),
    plan:
      o.plan ??
      (async () => {
        asked.push("plan");
        return { roots_ok: true, mark_only: false, unseen: [], judged: [] } as unknown as ReapReport;
      }),
    tmpRoot: scratchDir("res235-tmp-"),
    uid: process.getuid?.() ?? 0,
    trashBin: null,
  };
}

test("parts: load reads no card and runs no plan; made runs no plan; candidates asks the plan about sangsoe's cards only", async () => {
  const root = scratchDir("res235-cards-");
  const store = Store.open({ path: ":memory:" });
  const mine = { id: "w1", instanceId: "inst-w1", path: root, branch: "refs/heads/w1", isMainWorktree: false } as WorktreeRow;
  const other = { id: "w2", instanceId: "inst-w2", path: root, branch: "refs/heads/w2", isMainWorktree: false } as WorktreeRow;
  store.append({
    type: "unit_started",
    source: "start_unit",
    entity: "task",
    entity_id: "task_w1",
    payload: { kind: "default", picked_by: "role", model: "row", effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0, worktree: "w1" },
  });

  const l = deps({ store, cards: [mine, other] });
  const load = await readResourcePart(l, "load");
  assert.equal(load.part, "load");
  assert.ok(load.part === "load" && load.load.ok && load.load.value.loadPerCpu === 0.5);
  assert.deepEqual(l.asked, ["diagnosticsMemory"], "the load part is one point read");

  const m = deps({ store, cards: [mine, other] });
  const made = await readResourcePart(m, "made");
  assert.ok(made.part === "made" && made.made.worktrees.ok && made.made.worktrees.value.count === 1);
  assert.ok(!m.asked.includes("plan"), "made runs no REAPER plan");

  let opts: ReapOptions | null = null;
  const c = deps({
    store,
    cards: [mine, other],
    plan: async (o) => {
      opts = o;
      return { roots_ok: true, mark_only: false, unseen: [], judged: [{ ref: "inst-w1", name: "w1", path: root, gone: false, state: "finished", why: "PR #1" }] } as unknown as ReapReport;
    },
  });
  const cand = await readResourcePart(c, "candidates");
  assert.ok(cand.part === "candidates" && cand.worktrees.ok);
  assert.deepEqual(cand.part === "candidates" && cand.worktrees.ok ? cand.worktrees.value.rows.map((r) => r.ref) : [], ["inst-w1"]);
  const asked = opts as ReapOptions | null;
  assert.deepEqual(asked?.only ? [...asked.only] : null, ["inst-w1"], "the plan is narrowed to sangsoe's cards");
  assert.equal(asked?.explain, true);
});

test("the whole read (sangsoe reap plan) is the three parts together, with the band", async () => {
  const v = await readResources(deps());
  assert.ok(v.load.ok);
  assert.ok(v.made.processes.ok);
  assert.ok(v.worktrees.ok);
  assert.deepEqual(v.band.spans.at(-1)?.to, new Date(NOW).toISOString());
});

test("band: high from pressure_high to capacity_free, its tone from the level it entered at; gaps with no timer round are unknown", () => {
  const rounds = (from: number, to: number) => {
    const out: { type: string; ts: string; payload: unknown; seq: number }[] = [];
    for (let t = from; t <= to; t += 10 * 60_000) out.push({ type: "reap_round", ts: new Date(t).toISOString(), payload: { trigger: "timer" }, seq: 0 });
    return out;
  };
  const rows = [
    ...rounds(NOW - 24 * H, NOW - 20 * H),
    // Orca closed from -20h to -6h: no round ran.
    ...rounds(NOW - 6 * H, NOW),
    { type: "pressure_high", ts: new Date(NOW - 5 * H).toISOString(), payload: { reason: "danger: 메모리 여유 8%" }, seq: 0 },
    { type: "capacity_free", ts: new Date(NOW - 4 * H).toISOString(), payload: { slots: 2 }, seq: 0 },
    { type: "pressure_high", ts: new Date(NOW - H).toISOString(), payload: { reason: "warn: load/CPU 1.50" }, seq: 0 },
  ].map((e, i) => ({ ...e, seq: i + 1 }));
  const band = loadBand(rows as never, NOW, 10 * 60_000);
  assert.equal(band.from, new Date(NOW - 24 * H).toISOString());
  const at = (h: number) => band.spans.find((s) => Date.parse(s.from) <= NOW - h * H && NOW - h * H < Date.parse(s.to))?.state;
  assert.equal(at(22), "ok");
  assert.equal(at(12), "unknown", "no timer round: the monitor was not running");
  assert.equal(at(4.5), "danger");
  assert.equal(at(3), "ok");
  assert.equal(at(0.5), "warn", "an episode still open runs to now");
  for (let i = 1; i < band.spans.length; i++) assert.equal(band.spans[i]?.from, band.spans[i - 1]?.to, "spans touch");
});

test("the load part draws the band from the store's rows and writes none", async () => {
  const clock = { now: NOW - 2 * H };
  const store = Store.open({ path: ":memory:", clock: () => new Date(clock.now).toISOString() });
  store.append({ type: "pressure_high", source: "resource-monitor", payload: { reason: "warn: x" }, dedupe_key: dedupeKey(eventDef("pressure_high") as EventDef, "0") });
  for (let round = 1; clock.now <= NOW; round++, clock.now += 10 * 60_000) {
    store.append({ type: "reap_round", source: "reaper", payload: { trigger: "timer", roots_ok: true, round } });
  }
  const before = store.events().length;
  const p = await readResourcePart(deps({ store }), "load");
  assert.ok(p.part === "load");
  assert.equal(p.part === "load" ? p.band.spans.at(-1)?.state : null, "warn");
  assert.equal(store.events().length, before);
});
