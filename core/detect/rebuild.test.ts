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
import { runMonitor } from "./run.ts";

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
  return { deps, writes };
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
