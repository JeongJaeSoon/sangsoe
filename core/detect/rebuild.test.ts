import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fixedClock } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import type { GhClient, GhResponse } from "../gh/client.ts";
import { hostRereadPending } from "../store/backup.ts";
import { Store } from "../store/store.ts";
import { nullChatProvider } from "./chat/provider.ts";
import { DEFAULT_MONITOR_CONFIG, type MonitorDeps } from "./monitor.ts";
import { rereadHostRows } from "./rebuild.ts";
import { afterHostReread, runMonitor } from "./run.ts";

const tmp = mkdtempSync(join(tmpdir(), "sangsoe-rebuild-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const REPO = "acme/api";
const SHA = "1".repeat(40);
const HEAD = "a".repeat(40);
const NOW = Date.parse("2026-11-11T12:00:00Z");
const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });
const pull = (n: number, o: Record<string, unknown> = {}) => ({
  number: n,
  merged_at: null,
  user: { login: "alice" },
  head: { sha: HEAD, ref: `feature-${n}`, repo: { full_name: REPO } },
  base: { ref: "main" },
  labels: [],
  ...o,
});

/** Fake GitHub with one open PR (8) and one merged PR (7), both linked by Orca to a Task. */
function hosts() {
  const routes: Record<string, GhResponse<unknown>> = {
    [`repos/${REPO}/pulls?state=open&per_page=100`]: ok([pull(8)]),
    [`repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=30`]: ok([pull(7, { merged_at: "2026-11-11T11:00:00Z" })]),
    [`repos/${REPO}/pulls/7`]: ok({ ...pull(7), state: "closed", merged: true, merge_commit_sha: SHA, merged_by: { login: "alice" } }),
    [`repos/${REPO}`]: ok({ default_branch: "main" }),
    [`repos/${REPO}/compare/main...${SHA}`]: ok({ status: "behind" }),
  };
  const gh: GhClient = { get: async <T>(path: string) => (routes[path] ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T> };
  const writes: string[] = [];
  const task = (n: number) => `task_pr${n}`;
  const refs: Record<string, unknown[]> = Object.fromEntries(
    [7, 8].map((n) => [`https://github.com/${REPO}/pull/${n}`, [{ workspace: { id: `ws_${n}`, hostId: "local", archived: false }, agents: [{ mailbox: `dispatch:ctx_${n}`, linked: true }] }]]),
  );
  const none = { ok: false, error: { code: "unavailable", message: "" } };
  const orca = {
    referenceFind: async ({ query }: { query: string }) => ({ ok: true, value: { matches: refs[query] ?? [] } }),
    workerShow: async ({ dispatch }: { dispatch: string }) => {
      const n = Number(dispatch.replace("ctx_", ""));
      return { ok: true, value: { dispatchId: dispatch, state: "done", taskId: task(n), runId: "run_lead" } };
    },
    taskList: async () => ({ ok: true, value: [7, 8].map((n) => ({ id: task(n), status: "blocked", title: "t" })) }),
    workerList: async () => ({ ok: true, value: { rows: [], nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false } }),
    worktreeList: async () => ({ ok: true, value: { rows: [], nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false } }),
    worktreePs: async () => none,
    inbox: async () => none,
    gateList: async () => none,
    taskUpdate: async (a: { id: string; status: string }) => {
      writes.push(`task-update ${a.id} ${a.status}`);
      return { ok: true, value: {} };
    },
    referenceAdd: async () => {
      writes.push("reference add");
      return { ok: true, value: {} };
    },
    send: async (m: { to: string }) => {
      writes.push(`send ${m.to}`);
      return { ok: true, value: { message: { id: `msg_${writes.length}` } } };
    },
  } as unknown as OrcaAdapter;
  const deps = (store: Store): MonitorDeps => ({
    orca,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    now: () => NOW,
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({}),
    gh,
    watch: () => ({ repos: [REPO], authors: [], linkedOnly: true, owners: [] }),
    tier: () => null,
    core: { store, orca },
  });
  /** PR 8 approved by someone else and green at its head: ready once land asked for merge_on_approval. */
  const ready = () => {
    routes[`repos/${REPO}/pulls/8`] = ok({ ...pull(8), state: "open", mergeable_state: "clean" });
    routes[`repos/${REPO}/pulls/8/reviews?per_page=100&page=1`] = ok([{ user: { login: "bob" }, state: "APPROVED", commit_id: HEAD, author_association: "MEMBER" }]);
    routes[`repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`] = ok({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] });
  };
  return { deps, writes, ready };
}

const landOnApproval = (s: Store): void => {
  s.append({ type: "land_requested", source: "land", payload: { pr: `${REPO}#8`, head_sha: HEAD, reason: "merge_on_approval" } });
};

const sends = (writes: string[]) => writes.filter((w) => w.startsWith("send "));

/** Writes `before` into a store, loses the database file, and opens it again rebuilt from the backup. */
async function lose(name: string, before: (s: Store) => Promise<void> | void): Promise<Store> {
  const path = join(tmp, name);
  const s = Store.open({ path, clock: fixedClock("2026-11-11T12:00:00.000Z", 1000), fsProbe: () => "apfs" });
  await before(s);
  s.close();
  rmSync(path);
  const r = Store.open({ path, clock: fixedClock("2026-11-11T13:00:00.000Z", 1000), fsProbe: () => "apfs" });
  assert.ok(r.rebuilt);
  return r;
}

const hostRows = (s: Store) =>
  s
    .events()
    .filter((e) => e.type.startsWith("pr_"))
    .map((e) => `${e.type} ${e.dedupe_key}`)
    .sort();

test("a lost database gets its host rows back from Orca and GitHub, and the reread sends and changes nothing", async () => {
  const path = join(tmp, "s.db");
  const h = hosts();
  const s = Store.open({ path, clock: fixedClock("2026-11-11T12:00:00.000Z", 1000), fsProbe: () => "apfs" });
  await runMonitor("pr", h.deps(s));
  const before = hostRows(s);
  assert.ok(before.some((r) => r.startsWith("pr_merged ")) && before.some((r) => r.startsWith("pr_opened ")), "the ordinary round wrote host rows");
  assert.ok(h.writes.length > 0, "and ran its acts");
  s.close();
  rmSync(path);

  const r = Store.open({ path, clock: fixedClock("2026-11-11T13:00:00.000Z", 1000), fsProbe: () => "apfs" });
  assert.ok(r.rebuilt);
  assert.deepEqual(hostRows(r), [], "host rows are not in the backup");
  assert.equal(hostRereadPending(r.events({ type: "signal" })), true);

  const writesBefore = h.writes.length;
  const out = await rereadHostRows(h.deps(r));
  assert.deepEqual(hostRows(r), before, "the readers write the same host rows again");
  assert.equal(h.writes.length, writesBefore, "no task-update, reference add or message during the reread");
  assert.ok(out.unseen.some((u) => u.startsWith("orca: ")), "what a reader could not see is named");
  assert.equal(hostRereadPending(r.events({ type: "signal" })), false, "the reread is recorded once done");
  r.close();
});

test("a PR that became ready to merge while the database was lost wakes its lead once after the reread, and the next round sends none", async () => {
  const h = hosts();
  const r = await lose("ready.db", landOnApproval);
  h.ready();
  const out = await rereadHostRows(h.deps(r));
  assert.equal(hostRows(r).filter((x) => x.startsWith("pr_ready_to_merge ")).length, 1, "the ready row is written");
  assert.deepEqual(sends(h.writes), ["send run:run_lead"], "one wake to the owning lead");
  assert.equal(r.events({ type: "notified" }).length, 1, "notify records it");
  assert.deepEqual(out.acts.map((a) => [a.ok, a.detail]), [[true, "sent"]]);
  assert.ok(!h.writes.some((w) => w.startsWith("task-update") || w === "reference add"), "only the wake runs, no Task close or reference add");

  await runMonitor("pr", h.deps(r));
  assert.deepEqual(sends(h.writes), ["send run:run_lead"], "the next normal round sends none");
  r.close();
});

test("a wake sent before the loss is not sent again by the reread", async () => {
  const h = hosts();
  h.ready();
  const r = await lose("sent.db", async (s) => {
    landOnApproval(s);
    await runMonitor("pr", h.deps(s));
  });
  assert.deepEqual(sends(h.writes), ["send run:run_lead"]);
  const out = await rereadHostRows(h.deps(r));
  assert.equal(out.acts.length, 1, "the wake act runs");
  assert.notEqual(out.acts[0]?.detail, "sent", "and notify holds it back");
  assert.deepEqual(sends(h.writes), ["send run:run_lead"], "the copied notified row keeps it once");
  r.close();
});

/** Deps whose Orca writes note whether the host reread was still pending when they ran. */
function watched(h: ReturnType<typeof hosts>, r: Store) {
  const d = h.deps(r);
  const acts: string[] = [];
  const note = (what: string) => acts.push(hostRereadPending(r.events({ type: "signal" })) ? `${what} while pending` : what);
  const wrap =
    <A, R>(what: string, f: (a: A) => R) =>
    (a: A) => {
      note(what);
      return f(a);
    };
  const base = d.orca;
  const orca: OrcaAdapter = {
    ...base,
    taskUpdate: wrap("task-update", base.taskUpdate),
    referenceAdd: wrap("reference add", base.referenceAdd),
    send: wrap("send", base.send),
  };
  const run = afterHostReread({ ...d, orca, core: { store: r, orca } }, () => hostRereadPending(r.events({ type: "signal" })));
  return { run, acts };
}

test("a second caller on a reread the first caller aborted runs the reread again before its round, never a round while it is pending", async () => {
  const h = hosts();
  const r = await lose("abort-shared.db", () => {});
  const w = watched(h, r);
  const first = new AbortController();
  const a = w.run("pr", first.signal);
  first.abort();
  const b = w.run("pr", new AbortController().signal);
  await Promise.all([a, b]);
  assert.deepEqual(w.acts.filter((x) => x.endsWith(" while pending")), [], "no act before the reread completed");
  assert.equal(hostRereadPending(r.events({ type: "signal" })), false, "the second caller completed the reread");
  r.close();
});

test("a caller whose own reread was aborted runs no round; the next caller rereads first", async () => {
  const h = hosts();
  const r = await lose("abort-own.db", () => {});
  const w = watched(h, r);
  const first = new AbortController();
  const a = w.run("pr", first.signal);
  first.abort();
  const out = await a;
  assert.equal(w.acts.length, 0, "no act at all");
  assert.deepEqual(out.written, []);
  assert.equal(out.aborted, true);
  assert.deepEqual(out.unseen, ["host rows not read again yet"], "no round ran");
  assert.equal(hostRereadPending(r.events({ type: "signal" })), true, "the reread is still owed");
  await w.run("pr", new AbortController().signal);
  assert.deepEqual(w.acts.filter((x) => x.endsWith(" while pending")), []);
  assert.equal(hostRereadPending(r.events({ type: "signal" })), false);
  r.close();
});

test("a reread that cannot record itself stops instead of spinning, and runs no round", async () => {
  const h = hosts();
  const r = await lose("no-append.db", () => {});
  const { append: _, ...d } = h.deps(r);
  const out = await afterHostReread(d, () => true)("pr", new AbortController().signal);
  assert.equal(out.aborted, true);
  assert.deepEqual(h.writes, []);
  r.close();
});

test("a reread that sees nothing ready sends none", async () => {
  const h = hosts();
  const r = await lose("none.db", landOnApproval);
  const out = await rereadHostRows(h.deps(r));
  assert.deepEqual(sends(h.writes), []);
  assert.deepEqual(out.acts, []);
  assert.ok(!hostRows(r).some((x) => x.startsWith("pr_ready_to_merge ")));
  r.close();
});
