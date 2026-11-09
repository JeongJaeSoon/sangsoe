import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dedupeKey, EVENTS, type StoredEvent } from "../contract/index.ts";
import type { ExecResult } from "../contract/orca.ts";
import type { GhClient, GhResponse } from "../gh/client.ts";
import { Store } from "../store/store.ts";
import type { TierConfig } from "../verify/verify-tier.ts";
import { type PrGate, parsePrGate, readPrGate } from "./github.ts";
import { type LandDeps, type LandInput, land } from "./land.ts";
import { ghMerge, ghMergeNow, readLandConfig } from "./ports.ts";

// Decision 158: on a repo listed in verdict_merge_repos, a recorded independent verdict at the
// exact head is the approval decisions 72/81 wait for, and land merges at once.

const REPO = "acme/api";
const PR = "acme/api#12";
const HEAD = "a".repeat(40);
const OLD = "c".repeat(40);
const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });
const TIER: TierConfig = {
  docs_globs: ["docs/"],
  test_globs: ["test/"],
  ui_globs: ["web/"],
  v3_globs: [".github/"],
  protected_paths: [],
  owners: [],
};
const NO_RULES: unknown[] = [];
const GREEN: PrGate = {
  headSha: HEAD,
  unresolvedThreads: 0,
  checks: [
    { name: "unit", required: false, state: "pass" },
    { name: "lint", required: false, state: "pass" },
  ],
  methods: ["squash", "merge", "rebase"],
};

type World = {
  files?: unknown[];
  pull?: Record<string, unknown>;
  gate?: PrGate | "unreadable" | "absent";
  optIn?: boolean;
  protectedPaths?: string[];
  mergeNowOk?: boolean;
};

function harness(w: World = {}) {
  const store = Store.open({ path: ":memory:" });
  const routes: Record<string, GhResponse<unknown>> = {
    [`repos/${REPO}/pulls/12`]: ok({
      state: "open",
      draft: false,
      head: { sha: HEAD },
      base: { ref: "main" },
      user: { login: "Alice" },
      labels: [],
      mergeable_state: "clean",
      ...w.pull,
    }),
    [`repos/${REPO}/pulls/12/files?per_page=100&page=1`]: ok(w.files ?? [{ filename: "core/a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }]),
    [`repos/${REPO}/rules/branches/main`]: ok(NO_RULES),
    [`repos/${REPO}/branches/main/protection`]: { kind: "error", status: 403, message: "Resource not accessible by integration" },
    [`repos/${REPO}/pulls/12/reviews?per_page=100&page=1`]: ok([]),
  };
  const paths: string[] = [];
  const gh: GhClient = {
    async get<T>(path: string) {
      paths.push(path);
      return (routes[path] ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T>;
    },
  };
  const merges: unknown[] = [];
  const mergesNow: unknown[] = [];
  const gateReads: unknown[] = [];
  let edit: (e: StoredEvent[]) => StoredEvent[] = (e) => e;
  const deps: LandDeps = {
    gh,
    openStore: () => ({ events: () => edit(store.events()), append: (e) => store.append(e), close: () => {} }),
    merge: async (a) => {
      merges.push(a);
      return { ok: true, message: "auto-merge enabled" };
    },
    config: () => ({
      tier: TIER,
      protectedPaths: w.protectedPaths ?? [],
      ...(w.optIn === false ? {} : { verdictMergeRepos: [REPO] }),
    }),
  };
  const gate = w.gate;
  if (gate !== "absent") {
    deps.prGate = async (a) => {
      gateReads.push(a);
      if (gate === "unreadable") return { kind: "unreadable", why: "graphql: HTTP 502" };
      return { kind: "ok", data: gate ?? GREEN };
    };
  }
  deps.mergeNow = async (a) => {
    mergesNow.push(a);
    return w.mergeNowOk === false ? { ok: false, message: "Head branch was modified" } : { ok: true, message: "merged" };
  };
  return {
    store,
    deps,
    merges,
    mergesNow,
    gateReads,
    paths,
    editEvents: (f: (e: StoredEvent[]) => StoredEvent[]) => {
      edit = f;
    },
  };
}

const verdict = (store: Store, o: { head?: string; reviewer?: string; author?: string; actOn?: number } = {}) => {
  const reviewer = o.reviewer ?? "claude";
  const head = o.head ?? HEAD;
  return store.append({
    type: "review_verdict",
    source: "review record",
    actor: reviewer,
    dedupe_key: dedupeKey(EVENTS.review_verdict, PR, head, reviewer),
    payload: { pr: PR, head_sha: head, act_on: o.actOn ?? 0, reviewer, author: o.author ?? "alice" },
  });
};
const evidence = (store: Store, kind: string, head = HEAD) =>
  store.append({ type: "evidence", source: "test", subject: PR, actor: "worker:u30", payload: { kind, head_sha: head, exit_code: 0, not_verified: ["prod"] } });
const ready = (store: Store) => {
  verdict(store);
  evidence(store, "test");
  evidence(store, "run");
};
const landRows = (store: Store) =>
  store.events().filter((e) => e.type === "land_failed" || e.type === "land_requested").map((e) => `${e.type}:${String(e.payload.reason ?? "")}`);
const input = (extra: Partial<LandInput> = {}): LandInput => ({ repo: REPO, pr: 12, ...extra });
const refusal = (r: Awaited<ReturnType<typeof land>>) => (r.ok ? `ok:${r.value.action}` : r.refusal.reason.split(" ")[0]);

test("opted in: a verdict at the head by a non-author, green checks and evidence merge at once, pinned to the head", async () => {
  const h = harness();
  ready(h.store);
  const r = await land(input(), h.deps);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.action, "merge_verdict");
  assert.deepEqual(h.mergesNow, [{ repo: REPO, pr: 12, head: HEAD, method: "squash" }]);
  assert.deepEqual(h.merges, [], "no --auto");
  assert.deepEqual(h.gateReads, [{ repo: REPO, pr: 12 }]);
  assert.deepEqual(landRows(h.store), ["land_requested:verdict_approved"]);
});

test("opted out: the same PR is merge_on_approval as today, and the gate is never read", async () => {
  const h = harness({ optIn: false });
  ready(h.store);
  const r = await land(input(), h.deps);
  assert.equal(refusal(r), "ok:merge_on_approval");
  assert.deepEqual([h.mergesNow, h.merges, h.gateReads], [[], [], []]);
  assert.deepEqual(landRows(h.store), ["land_requested:merge_on_approval"]);
});

test("the dry run takes the same path and writes nothing", async () => {
  const h = harness();
  ready(h.store);
  const r = await land(input({ dryRun: true }), h.deps);
  assert.equal(refusal(r), "ok:merge_verdict");
  assert.deepEqual([h.mergesNow, landRows(h.store)], [[], []]);
  assert.match(r.ok ? r.value.note : "", /verdict by claude at aaaaaaa/);
});

test("fail closed: a verdict inherited by patch-id from an older head does not count here", async () => {
  const h = harness();
  verdict(h.store, { head: OLD });
  evidence(h.store, "test");
  evidence(h.store, "run");
  h.store.append({ type: "pr_base_changed", source: "pr-monitor", payload: { pr: PR, from: "feature-a", to: "main" } });
  const same = ok({ status: "ahead", files: [{ filename: "core/a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }] });
  const gh = h.deps.gh;
  h.deps.gh = { get: async <T>(p: string) => (p.includes("/compare/") ? (same as GhResponse<T>) : gh.get<T>(p)) };
  const r = await land(input(), h.deps);
  assert.equal(refusal(r), "verdict_not_at_head");
  assert.deepEqual(h.mergesNow, []);
  assert.deepEqual(landRows(h.store), ["land_failed:verdict_not_at_head"]);
});

test("fail closed: a verdict whose source, recorder or author does not match is not counted", async () => {
  const cases: [string, (e: StoredEvent) => StoredEvent][] = [
    ["unknown source", (e) => ({ ...e, source: "hand" })],
    ["recorder is not the reviewer", (e) => ({ ...e, actor: "worker:u30" })],
    ["no recorder", (e) => ({ ...e, actor: null })],
    ["verdict about another author", (e) => ({ ...e, payload: { ...e.payload, author: "bob" } })],
    ["reviewer is the GitHub author", (e) => ({ ...e, payload: { ...e.payload, reviewer: "alice", author: "zed" }, actor: "alice" })],
    ["act_on unreadable", (e) => ({ ...e, payload: { ...e.payload, act_on: "none" } })],
  ];
  for (const [name, change] of cases) {
    const h = harness();
    ready(h.store);
    h.editEvents((rows) => rows.map((e) => (e.type === "review_verdict" ? change(e) : e)));
    const r = await land(input(), h.deps);
    assert.equal(refusal(r), "verdict_unaccepted", name);
    assert.deepEqual(h.mergesNow, [], name);
  }
});

test("fail closed: the gate's GraphQL read is unreadable or the port is missing", async () => {
  for (const gate of ["unreadable", "absent"] as const) {
    const h = harness({ gate });
    ready(h.store);
    assert.equal(refusal(await land(input(), h.deps)), "gate_unreadable", gate);
    assert.deepEqual(h.mergesNow, []);
  }
});

test("fail closed: the head GitHub reports moved after the REST read", async () => {
  const h = harness({ gate: { ...GREEN, headSha: OLD } });
  ready(h.store);
  assert.equal(refusal(await land(input(), h.deps)), "head_moved");
  assert.deepEqual(h.mergesNow, []);
});

test("fail closed: an unresolved review thread", async () => {
  const h = harness({ gate: { ...GREEN, unresolvedThreads: 2 } });
  ready(h.store);
  assert.equal(refusal(await land(input(), h.deps)), "threads_unresolved:2");
});

test("fail closed: red or pending required checks, and no checks at all", async () => {
  const cases: [PrGate["checks"], string][] = [
    [[{ name: "unit", required: true, state: "fail" }, { name: "lint", required: false, state: "pass" }], "checks_red:unit"],
    [[{ name: "unit", required: true, state: "pending" }], "checks_pending:unit"],
    [[{ name: "unit", required: false, state: "pass" }, { name: "lint", required: false, state: "fail" }], "checks_red:lint"],
    [[{ name: "unit", required: false, state: "pending" }], "checks_pending:unit"],
    [[], "checks_missing"],
  ];
  for (const [checks, want] of cases) {
    const h = harness({ gate: { ...GREEN, checks } });
    ready(h.store);
    assert.equal(refusal(await land(input(), h.deps)), want, want);
    assert.deepEqual(h.mergesNow, []);
  }
});

test("when GitHub names required checks, only those must pass", async () => {
  const h = harness({
    gate: { ...GREEN, checks: [{ name: "unit", required: true, state: "pass" }, { name: "bot", required: false, state: "fail" }] },
  });
  ready(h.store);
  assert.equal(refusal(await land(input(), h.deps)), "ok:merge_verdict");
});

test("fail closed: GitHub does not call the PR mergeable", async () => {
  for (const state of ["blocked", "dirty", "unknown", undefined]) {
    const h = harness({ pull: { mergeable_state: state } });
    ready(h.store);
    assert.equal(refusal(await land(input(), h.deps)), `not_mergeable:${state ?? "unknown"}`);
  }
});

test("protected paths and V3 stay the owner's: merge_on_approval, as today", async () => {
  const prot = harness({ protectedPaths: ["infra/"], files: [{ filename: "infra/a.tf", patch: "@@ -1 +1 @@\n-a\n+b" }] });
  ready(prot.store);
  const r1 = await land(input(), prot.deps);
  assert.equal(refusal(r1), "ok:merge_on_approval");
  assert.match(r1.ok ? r1.value.note : "", /protected path/);

  const v3 = harness({ files: [{ filename: ".github/workflows/ci.yml", patch: "@@ -1 +1 @@\n-a\n+b" }] });
  ready(v3.store);
  evidence(v3.store, "dev");
  const r2 = await land(input(), v3.deps);
  assert.equal(refusal(r2), "ok:merge_on_approval");
  assert.match(r2.ok ? r2.value.note : "", /V3/);
  assert.deepEqual([prot.mergesNow, v3.mergesNow, prot.gateReads, v3.gateReads], [[], [], [], []]);
});

test("the merge method is the repo's first allowed of squash, merge, rebase; none refuses", async () => {
  const rebase = harness({ gate: { ...GREEN, methods: ["rebase"] } });
  ready(rebase.store);
  await land(input(), rebase.deps);
  assert.deepEqual(rebase.mergesNow, [{ repo: REPO, pr: 12, head: HEAD, method: "rebase" }]);
  const none = harness({ gate: { ...GREEN, methods: [] } });
  ready(none.store);
  assert.equal(refusal(await land(input(), none.deps)), "merge_method_unreadable");
  assert.deepEqual(none.mergesNow, []);
});

test("GitHub refusing the plain merge is land_failed{merge_refused}", async () => {
  const h = harness({ mergeNowOk: false });
  ready(h.store);
  const r = await land(input(), h.deps);
  assert.equal(refusal(r), "merge_refused");
  assert.deepEqual(landRows(h.store), ["land_failed:merge_refused"]);
});

test("missing evidence still refuses before anything on this path is read", async () => {
  const h = harness();
  verdict(h.store);
  evidence(h.store, "test");
  assert.equal(refusal(await land(input(), h.deps)), "evidence_missing:run");
  assert.deepEqual(h.gateReads, []);
});

function fakeExec(stdout: string, code = 0) {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    exec: async (file: string, args: readonly string[]): Promise<ExecResult> => {
      calls.push([file, ...args]);
      return { code, stdout, stderr: "" };
    },
  };
}

test("argv: the plain merge is gh pr merge with the method and --match-head-commit, and no --auto", async () => {
  const f = fakeExec("");
  const r = await ghMergeNow(f.exec)({ repo: REPO, pr: 12, head: HEAD, method: "squash" });
  assert.deepEqual(f.calls, [["gh", "pr", "merge", "12", "--repo", REPO, "--squash", "--match-head-commit", HEAD]]);
  assert.equal(r.ok, true);
  const m = fakeExec("");
  await ghMergeNow(m.exec)({ repo: REPO, pr: 12, head: HEAD, method: "merge" });
  assert.deepEqual(m.calls[0], ["gh", "pr", "merge", "12", "--repo", REPO, "--merge", "--match-head-commit", HEAD]);
});

test("argv: the scheduled merge decision 81 makes is unchanged", async () => {
  const f = fakeExec("");
  await ghMerge(f.exec)({ repo: REPO, pr: 12, head: HEAD });
  assert.deepEqual(f.calls, [["gh", "pr", "merge", "12", "--repo", REPO, "--auto", "--squash", "--match-head-commit", HEAD]]);
});

const rollup = (o: { threads?: unknown; contexts?: unknown; head?: string; squash?: unknown } = {}) =>
  JSON.stringify({
    data: {
      repository: {
        squashMergeAllowed: "squash" in o ? o.squash : false,
        mergeCommitAllowed: true,
        rebaseMergeAllowed: true,
        pullRequest: {
          headRefOid: o.head ?? HEAD,
          reviewThreads: o.threads ?? { pageInfo: { hasNextPage: false }, nodes: [{ isResolved: true }, { isResolved: false }] },
          commits: {
            nodes: [
              {
                commit: {
                  oid: o.head ?? HEAD,
                  statusCheckRollup: {
                    contexts: o.contexts ?? {
                      pageInfo: { hasNextPage: false },
                      nodes: [
                        { __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "SUCCESS", isRequired: true },
                        { __typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: null, isRequired: false },
                        { __typename: "CheckRun", name: "bot", status: "COMPLETED", conclusion: "SKIPPED", isRequired: false },
                        { __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "FAILURE", isRequired: false },
                        { __typename: "StatusContext", context: "ci/legacy", state: "PENDING", isRequired: false },
                        { __typename: "StatusContext", context: "ci/ok", state: "SUCCESS", isRequired: true },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  });

test("parsePrGate: head, unresolved threads and each check's required flag and state", () => {
  const r = parsePrGate(rollup());
  assert.deepEqual(r, {
    kind: "ok",
    data: {
      headSha: HEAD,
      unresolvedThreads: 1,
      checks: [
        { name: "unit", required: true, state: "pass" },
        { name: "lint", required: false, state: "pending" },
        { name: "bot", required: false, state: "pass" },
        { name: "e2e", required: false, state: "fail" },
        { name: "ci/legacy", required: false, state: "pending" },
        { name: "ci/ok", required: true, state: "pass" },
      ],
      methods: ["merge", "rebase"],
    },
  });
});

test("parsePrGate fails closed: more pages, an unknown kind, a missing field, not JSON", () => {
  const bad = [
    rollup({ squash: null }),
    rollup({ threads: { pageInfo: { hasNextPage: true }, nodes: [] } }),
    rollup({ contexts: { pageInfo: { hasNextPage: true }, nodes: [] } }),
    rollup({ contexts: { pageInfo: { hasNextPage: false }, nodes: [{ __typename: "Mystery", name: "x" }] } }),
    rollup({ contexts: { pageInfo: { hasNextPage: false }, nodes: [{ __typename: "CheckRun", name: "x", status: "COMPLETED", conclusion: "SUCCESS" }] } }),
    rollup().replace(`"oid":"${HEAD}"`, `"oid":"${OLD}"`),
    JSON.stringify({ data: { repository: { pullRequest: null } } }),
    "not json",
  ];
  for (const s of bad) assert.equal(parsePrGate(s).kind, "unreadable", s.slice(0, 80));
});

test("parsePrGate: a commit with no rollup has no checks", () => {
  const s = JSON.stringify({
    data: {
      repository: {
        squashMergeAllowed: true,
        mergeCommitAllowed: false,
        rebaseMergeAllowed: false,
        pullRequest: { headRefOid: HEAD, reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] }, commits: { nodes: [{ commit: { oid: HEAD, statusCheckRollup: null } }] } },
      },
    },
  });
  assert.deepEqual(parsePrGate(s), { kind: "ok", data: { headSha: HEAD, unresolvedThreads: 0, checks: [], methods: ["squash"] } });
});

test("readPrGate passes owner, name and number as GraphQL variables", async () => {
  const f = fakeExec(rollup());
  const r = await readPrGate(f.exec)({ repo: REPO, pr: 12 });
  assert.equal(r.kind, "ok");
  const argv = f.calls[0] ?? [];
  assert.deepEqual(argv.slice(0, 3), ["gh", "api", "graphql"]);
  for (const v of ["owner=acme", "name=api", "number=12"]) assert.ok(argv.includes(v), v);
  assert.equal((await readPrGate(fakeExec("", 1).exec)({ repo: REPO, pr: 12 })).kind, "unreadable");
});

test("readLandConfig: verdict_merge_repos is opt-in, lowercased, and anything else is off", () => {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-land-config-"));
  const write = (v: unknown) => {
    mkdirSync(join(home, ".config", "sangsoe"), { recursive: true });
    writeFileSync(join(home, ".config", "sangsoe", "config.json"), JSON.stringify(v));
  };
  write({ verdict_merge_repos: ["Acme/API", "acme/web"] });
  assert.deepEqual(readLandConfig(home).verdictMergeRepos, ["acme/api", "acme/web"]);
  for (const off of [{}, { verdict_merge_repos: "acme/api" }, { verdict_merge_repos: ["acme/api", 3] }, { verdict_merge_repos: ["no-slash"] }]) {
    write(off);
    assert.deepEqual(readLandConfig(home).verdictMergeRepos, [], JSON.stringify(off));
  }
  rmSync(home, { recursive: true, force: true });
});
