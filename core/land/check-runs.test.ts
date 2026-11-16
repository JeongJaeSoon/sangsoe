import assert from "node:assert/strict";
import { test } from "node:test";
import type { GhClient, GhResponse } from "../gh/client.ts";
import { approvedAndGreen, type Pull, parsePrGate } from "./github.ts";

// Decision 319: a check name that ran several times on one head is judged by its latest run, as
// GitHub's merge box does, so a `cancelled` run that a label event's concurrency group left behind
// does not turn a green check red.

const REPO = "acme/api";
const HEAD = "a".repeat(40);

type Run = { name: string; status: string; conclusion: string | null; startedAt?: string; completedAt?: string | undefined };
const run = (conclusion: string | null, at: string, name = "unit", status = "COMPLETED"): Run => ({
  name,
  status,
  conclusion,
  startedAt: at,
  completedAt: conclusion === null ? undefined : at,
});

function gate(runs: Run[]) {
  const nodes = runs.map((r) => ({ __typename: "CheckRun", isRequired: true, ...r }));
  const r = parsePrGate(
    JSON.stringify({
      data: {
        repository: {
          squashMergeAllowed: true,
          mergeCommitAllowed: false,
          rebaseMergeAllowed: false,
          pullRequest: {
            headRefOid: HEAD,
            reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] },
            commits: { nodes: [{ commit: { oid: HEAD, statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false }, nodes } } } }] },
          },
        },
      },
    }),
  );
  assert.equal(r.kind, "ok");
  return r.kind === "ok" ? r.data.checks : [];
}

const FIVE = [
  run("SUCCESS", "2026-11-16T10:00:00Z"),
  run("CANCELLED", "2026-11-16T10:01:00Z"),
  run("SUCCESS", "2026-11-16T10:02:00Z"),
  run("CANCELLED", "2026-11-16T10:03:00Z"),
  run("CANCELLED", "2026-11-16T10:04:00Z"),
];

test("parsePrGate: two successes and three later cancelled runs of one name are green", () => {
  assert.deepEqual(gate(FIVE), [{ name: "unit", required: true, state: "pass" }]);
});

test("parsePrGate: the order GitHub lists the runs in does not matter, the time does", () => {
  assert.deepEqual(gate([...FIVE].reverse()), [{ name: "unit", required: true, state: "pass" }]);
});

test("parsePrGate: a latest run that failed or timed out is red, whatever passed before", () => {
  for (const bad of ["FAILURE", "TIMED_OUT"]) {
    assert.deepEqual(gate([run("SUCCESS", "2026-11-16T10:00:00Z"), run(bad, "2026-11-16T10:05:00Z")]), [{ name: "unit", required: true, state: "fail" }], bad);
  }
});

test("parsePrGate: a success after an older failure is green", () => {
  assert.deepEqual(gate([run("FAILURE", "2026-11-16T10:00:00Z"), run("SUCCESS", "2026-11-16T10:05:00Z")]), [{ name: "unit", required: true, state: "pass" }]);
});

test("parsePrGate: only cancelled runs is its own state, not red", () => {
  assert.deepEqual(gate([run("CANCELLED", "2026-11-16T10:00:00Z"), run("CANCELLED", "2026-11-16T10:01:00Z")]), [{ name: "unit", required: true, state: "cancelled" }]);
});

test("parsePrGate: a failure hides behind a later cancelled run: success, failure, cancelled is red", () => {
  const runs = [run("SUCCESS", "2026-11-16T10:00:00Z"), run("FAILURE", "2026-11-16T10:05:00Z"), run("CANCELLED", "2026-11-16T10:10:00Z")];
  assert.deepEqual(gate(runs), [{ name: "unit", required: true, state: "fail" }]);
});

test("parsePrGate: a failure then a cancelled run is red, as the failure is the latest that counts", () => {
  assert.deepEqual(gate([run("FAILURE", "2026-11-16T10:00:00Z"), run("CANCELLED", "2026-11-16T10:01:00Z")]), [{ name: "unit", required: true, state: "fail" }]);
});

test("parsePrGate: a newer run still going is pending", () => {
  assert.deepEqual(gate([run("SUCCESS", "2026-11-16T10:00:00Z"), run(null, "2026-11-16T10:05:00Z", "unit", "IN_PROGRESS")]), [{ name: "unit", required: true, state: "pending" }]);
});

test("parsePrGate: names are judged apart and keep their first-seen order", () => {
  const checks = gate([run("CANCELLED", "2026-11-16T10:00:00Z", "lint"), run("SUCCESS", "2026-11-16T10:00:00Z", "unit"), run("SUCCESS", "2026-11-16T10:01:00Z", "lint"), run("CANCELLED", "2026-11-16T10:02:00Z", "unit")]);
  assert.deepEqual(checks, [
    { name: "lint", required: true, state: "pass" },
    { name: "unit", required: true, state: "pass" },
  ]);
});

test("parsePrGate: without timestamps the later entry is the latest", () => {
  const bare = (conclusion: string): Run => ({ name: "unit", status: "COMPLETED", conclusion });
  assert.deepEqual(gate([bare("SUCCESS"), bare("CANCELLED")]), [{ name: "unit", required: true, state: "pass" }]);
  assert.deepEqual(gate([bare("CANCELLED"), bare("FAILURE")]), [{ name: "unit", required: true, state: "fail" }]);
});

type RestRun = { name: string; status: string; conclusion: string | null; started_at?: string; completed_at?: string | undefined };
const rest = (conclusion: string | null, at: string, name = "unit"): RestRun => ({ name, status: conclusion === null ? "in_progress" : "completed", conclusion, started_at: at, completed_at: conclusion === null ? undefined : at });

async function greenFor(runs: RestRun[]): Promise<boolean | string> {
  const routes: Record<string, GhResponse<unknown>> = {
    [`repos/${REPO}/pulls/12/reviews?per_page=100&page=1`]: { kind: "ok", status: 200, data: [{ user: { login: "reviewer-a" }, state: "APPROVED", commit_id: HEAD, author_association: "MEMBER" }] },
    [`repos/${REPO}/commits/${HEAD}/check-runs?per_page=100`]: { kind: "ok", status: 200, data: { total_count: runs.length, check_runs: runs } },
  };
  const gh: GhClient = { get: async <T>(path: string) => (routes[path] ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T> };
  const pull: Pull = { state: "open", mergeable_state: "clean", head: { sha: HEAD }, base: { ref: "main" }, user: { login: "author-a" } };
  const r = await approvedAndGreen(gh, REPO, 12, pull, []);
  return r.kind === "ok" ? r.data : r.kind;
}

test("approvedAndGreen reads the same judgement: successes then cancelled runs are green", async () => {
  const runs = [rest("success", "2026-11-16T10:00:00Z"), rest("cancelled", "2026-11-16T10:01:00Z"), rest("success", "2026-11-16T10:02:00Z"), rest("cancelled", "2026-11-16T10:03:00Z"), rest("cancelled", "2026-11-16T10:04:00Z")];
  assert.equal(await greenFor(runs), true);
});

test("approvedAndGreen: a latest failure or only cancelled runs are not green", async () => {
  assert.equal(await greenFor([rest("success", "2026-11-16T10:00:00Z"), rest("failure", "2026-11-16T10:01:00Z")]), false);
  assert.equal(await greenFor([rest("cancelled", "2026-11-16T10:00:00Z")]), false);
  assert.equal(await greenFor([rest("success", "2026-11-16T10:00:00Z"), rest("failure", "2026-11-16T10:01:00Z"), rest("cancelled", "2026-11-16T10:02:00Z")]), false);
});
