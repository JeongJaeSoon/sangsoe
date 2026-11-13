// Decision 234: what the panel's 리소스 section reads, and the confirmed 정리 behind its button.
// Every path here lives under a scratch directory; nothing reaches this machine's real $TMPDIR.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  dedupeKey,
  type EventDef,
  eventDef,
  type Exec,
  ownerReap,
  processUsage,
  type ReapOptions,
  type ReapReport,
  readResources,
  type ResourceDeps,
  Store,
  TMP_MIN_AGE_MS,
  tmpLeftovers,
  type WorktreeRow,
} from "../../core/index.ts";
import { scratchDir } from "../scratch.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const UID = process.getuid?.() ?? 0;

function tmpRoot(): string {
  const root = scratchDir("res-tmp-");
  const mk = (name: string, ageMs: number, file = false) => {
    const p = join(root, name);
    if (file) writeFileSync(p, "x");
    else mkdirSync(p);
    const t = (NOW - ageMs) / 1000;
    utimesSync(p, t, t);
  };
  mk("sangsoe-hook-abc123", 2 * TMP_MIN_AGE_MS);
  mk("sangsoe-session-Xy9Z0q", 2 * TMP_MIN_AGE_MS);
  mk("sangsoe-mail-young1", 60_000);
  mk("sangsoe-record-file01", 2 * TMP_MIN_AGE_MS, true);
  mk("sangsoe-land-config-abc123", 2 * TMP_MIN_AGE_MS);
  mk("sangsoe-hook-toolongname", 2 * TMP_MIN_AGE_MS);
  mk("other-hook-abc123", 2 * TMP_MIN_AGE_MS);
  return root;
}

test("leftovers: the five per-call prefixes, a mkdtemp tail, a directory this user owns, an hour old", () => {
  const root = tmpRoot();
  const names = (ps: string[]) => ps.map((p) => p.slice(root.length + 1)).sort();
  assert.deepEqual(names(tmpLeftovers(root, NOW, UID)), ["sangsoe-hook-abc123", "sangsoe-session-Xy9Z0q"]);
  assert.deepEqual(names(tmpLeftovers(root, NOW, UID, 0)), ["sangsoe-hook-abc123", "sangsoe-mail-young1", "sangsoe-session-Xy9Z0q"]);
  assert.deepEqual(tmpLeftovers(root, NOW, UID + 1), [], "another user's directories are never listed");
});

test("processes: claude and node by name with resident memory; anything else is left out", async () => {
  const exec: Exec = async () => ({ code: 0, stdout: " 2048 /usr/local/bin/node\n 1024 claude\n  512 /bin/zsh\n 4096 node\n", stderr: "" });
  assert.deepEqual(await processUsage(exec), { ok: true, value: { claude: { count: 1, kb: 1024 }, node: { count: 2, kb: 6144 } } });
  const failed: Exec = async () => ({ code: 1, stdout: "", stderr: "no" });
  assert.equal((await processUsage(failed)).ok, false);
});

const row = (id: string, path: string, o: Partial<WorktreeRow> = {}): WorktreeRow =>
  ({ id, instanceId: `inst-${id}`, path, branch: `refs/heads/${id}`, isMainWorktree: false, hostId: "local", ...o }) as WorktreeRow;

function deps(o: { root: string; plan?: Partial<ReapReport>; listFails?: boolean; store?: Store; cards?: WorktreeRow[] }): ResourceDeps {
  const store = o.store ?? Store.open({ path: ":memory:" });
  const exec: Exec = async (file, args) => {
    if (file === "du") return { code: 0, stdout: args.slice(1).map((p) => `8\t${p}`).join("\n"), stderr: "" };
    if (file === "ps") return { code: 0, stdout: " 100 claude\n", stderr: "" };
    throw new Error(`unexpected ${file}`);
  };
  const cards = o.cards ?? [];
  return {
    orca: {
      worktreeList: async () =>
        o.listFails
          ? { ok: false, error: { code: "runtime_unreachable", message: "x" } }
          : { ok: true, value: { rows: cards, nonLocal: { rows: 0, hostIds: [], ids: [] }, omittedHostIds: [], truncated: false } },
      worktreePs: async () => ({
        ok: true,
        value: { rows: cards.map((c) => ({ worktreeId: c.id, liveTerminalCount: 2 }) as never), nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false },
      }),
      diagnosticsMemory: async () => ({ ok: true, value: { host: { availableMemory: 25, totalMemory: 100 } } }),
    } as unknown as ResourceDeps["orca"],
    exec,
    events: (f) => store.events(f),
    now: () => NOW,
    sample: () => ({ load5: 4, cpus: 8 }),
    plan: async () => ({ roots_ok: true, mark_only: false, unseen: [], judged: [], ...o.plan }) as ReapReport,
    tmpRoot: o.root,
    uid: UID,
    trashBin: "/usr/bin/trash",
  };
}

test("the view: load from one point read, sangsoe's own cards and terminals, leftovers and candidates", async () => {
  const root = tmpRoot();
  const store = Store.open({ path: ":memory:" });
  store.append({ type: "pressure_high", source: "resource-monitor", payload: { reason: "warn: load/CPU 1.50" }, dedupe_key: dedupeKey(eventDef("pressure_high") as EventDef, "0") });
  const mine = row("w1", root);
  const foreign = row("w2", root);
  const goneMine = row("w3", join(root, "nope"));
  const unfinished = row("w4", root);
  for (const c of [mine, goneMine, unfinished]) {
    store.append({
      type: "unit_started",
      source: "start_unit",
      entity: "task",
      entity_id: `task_${c.id}`,
      payload: { kind: "default", picked_by: "role", model: "row", effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0, worktree: c.id },
    });
  }
  const v = await readResources(
    deps({
      root,
      store,
      cards: [mine, foreign, goneMine, unfinished],
      plan: {
        judged: [
          { ref: "inst-w1", name: "a", path: root, gone: false, state: "finished", why: "PR #3" },
          { ref: "inst-w3", name: "b", path: join(root, "nope"), gone: true, state: "unknown", why: "no HEAD on the card row" },
          { ref: "inst-w4", name: "c", path: root, gone: false, state: "unfinished", why: "PR #4 did not carry HEAD" },
        ],
      },
    }),
  );
  assert.ok(v.load.ok);
  assert.equal(v.load.value.loadPerCpu, 0.5);
  assert.equal(v.load.value.memFreePct, 25, "macOS memory comes from Orca's diagnostics, as the resource monitor reads it");
  assert.equal(v.episode.state, "high");
  assert.deepEqual(v.made.worktrees, { ok: true, value: { count: 3, kb: 16 } }, "only the cards sangsoe started");
  assert.deepEqual(v.made.terminals, { ok: true, value: { count: 6 } });
  assert.deepEqual(v.made.processes, { ok: true, value: { claude: { count: 1, kb: 100 }, node: { count: 0, kb: 0 } } });
  assert.deepEqual(v.made.tmp, { ok: true, value: { count: 3, kb: 24 } });
  assert.deepEqual(v.tmp, { ok: true, value: { count: 2, kb: 16 } });
  assert.ok(v.worktrees.ok);
  assert.deepEqual(
    v.worktrees.value.rows.map((r) => [r.ref, r.kb]),
    [
      ["inst-w1", 8],
      ["inst-w3", 0],
    ],
    "an unfinished card is not offered",
  );
});

test("a finished worktree another program made is never a candidate, not even listed", async () => {
  const root = tmpRoot();
  const store = Store.open({ path: ":memory:" });
  const mine = row("w1", root);
  const other = row("other", root);
  store.append({
    type: "unit_started",
    source: "start_unit",
    entity: "task",
    entity_id: "task_1",
    payload: { kind: "default", picked_by: "role", model: "row", effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0, worktree: mine.id },
  });
  const judged = [
    { ref: "inst-w1", name: "mine", path: root, gone: false, state: "finished" as const, why: "PR #3" },
    { ref: "inst-other", name: "other", path: root, gone: false, state: "finished" as const, why: "PR #9" },
    { ref: "inst-gone-other", name: "gone", path: join(root, "nope"), gone: true, state: "unknown" as const, why: "no HEAD" },
  ];
  const v = await readResources(deps({ root, store, cards: [mine, other], plan: { judged } }));
  assert.ok(v.worktrees.ok);
  assert.deepEqual(v.worktrees.value.rows.map((r) => r.ref), ["inst-w1"]);

  const asked: ReapOptions[] = [];
  const out = await ownerReap(
    {
      run: async (o) => {
        asked.push(o);
        return { reaped: [], blocked: [], unseen: [], unknown: [], mark_only: false } as unknown as ReapReport;
      },
      mine: async () => new Set(["inst-w1"]),
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      now: () => NOW,
      tmpRoot: root,
      uid: UID,
      trashBin: null,
    },
    { worktrees: ["inst-w1", "inst-other"], tmp: false },
  );
  assert.deepEqual(asked, [{ trigger: "hint", confirmed: ["inst-w1"] }], "a named id sangsoe did not make never reaches the round");
  assert.deepEqual(out.skipped, ["not made by sangsoe: inst-other"]);
  const none = await ownerReap(
    { run: async () => assert.fail("no round"), mine: async () => null, exec: async () => assert.fail("no exec"), now: () => NOW, tmpRoot: root, uid: UID, trashBin: null },
    { worktrees: ["inst-w1"], tmp: false },
  );
  assert.deepEqual(none.skipped, ["sangsoe's worktrees could not be read: no card removed"]);
});

test("an unreadable root is shown as unread, never as zero", async () => {
  const root = tmpRoot();
  const v = await readResources(deps({ root, listFails: true, plan: { roots_ok: false, unseen: ["worktree list: runtime_unreachable"] } }));
  assert.deepEqual(v.made.worktrees, { ok: false, why: "worktree list: runtime_unreachable" });
  assert.deepEqual(v.worktrees, { ok: false, why: "worktree list: runtime_unreachable" });
});

test("정리: the confirmed ids go to one REAPER round, old leftovers to the trash, young ones stay", async () => {
  const root = tmpRoot();
  const trash = scratchDir("res-trash-");
  const asked: ReapOptions[] = [];
  const calls: string[][] = [];
  const exec: Exec = async (file, args) => {
    calls.push([file, ...args]);
    for (const p of args) renameSync(p, join(trash, p.slice(root.length + 1)));
    return { code: 0, stdout: "", stderr: "" };
  };
  const out = await ownerReap(
    {
      run: async (o) => {
        asked.push(o);
        return { reaped: ["worktree:inst-a"], blocked: [{ kind: "worktree", ref: "inst-b", reason: "uncommitted" }], unseen: [], unknown: [], mark_only: false } as unknown as ReapReport;
      },
      mine: async () => new Set(["inst-a", "inst-b"]),
      exec,
      now: () => NOW,
      tmpRoot: root,
      uid: UID,
      trashBin: "/usr/bin/trash",
    },
    { worktrees: ["inst-a", "inst-b"], tmp: true },
  );
  assert.deepEqual(asked, [{ trigger: "hint", confirmed: ["inst-a", "inst-b"] }]);
  assert.deepEqual(out.reaped, ["worktree:inst-a"]);
  assert.deepEqual(out.tmp, { moved: 2, left: 0 });
  assert.ok(calls.every((c) => c[0] === "/usr/bin/trash"), "only the trash command touches a file");
  assert.ok(existsSync(join(root, "sangsoe-mail-young1")), "a directory under an hour old stays");
  assert.ok(existsSync(join(trash, "sangsoe-hook-abc123")));
});

test("정리 without a trash command moves nothing, and no card list runs no round", async () => {
  const root = tmpRoot();
  const exec: Exec = async (file) => {
    throw new Error(`ran ${file}`);
  };
  const out = await ownerReap(
    {
      run: async () => {
        throw new Error("no round expected");
      },
      mine: async () => null,
      exec,
      now: () => NOW,
      tmpRoot: root,
      uid: UID,
      trashBin: null,
    },
    { worktrees: [], tmp: true },
  );
  assert.equal(out.tmp, null);
  assert.ok(existsSync(join(root, "sangsoe-hook-abc123")));
});

test("정리 reports only the listed cards, and a failing temp-folder half keeps what the round removed", async () => {
  const out = await ownerReap(
    {
      run: async () =>
        ({
          reaped: ["worktree:inst-a", "container:c1"],
          blocked: [],
          unseen: ["not finished: inst-b: open"],
          unknown: ["worktree:inst-other", "worktree:inst-b: rm busy", "worktree:inst-bb"],
          mark_only: false,
        }) as unknown as ReapReport,
      mine: async () => new Set(["inst-a", "inst-b", "inst-bb"]),
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      now: () => NOW,
      tmpRoot: join(scratchDir("res-gone-"), "missing"),
      uid: UID,
      trashBin: "/usr/bin/trash",
    },
    { worktrees: ["inst-a", "inst-b"], tmp: true },
  );
  assert.deepEqual(out.reaped, ["worktree:inst-a", "container:c1"]);
  assert.deepEqual(out.skipped.slice(0, 2), ["not finished: inst-b: open", "worktree:inst-b: rm busy"]);
  assert.equal(out.skipped.length, 3);
  assert.match(out.skipped[2] ?? "", /^임시 폴더를 읽지 못함: /);
  assert.equal(out.tmp, null);
});
