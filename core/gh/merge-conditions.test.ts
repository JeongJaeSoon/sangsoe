import assert from "node:assert/strict";
import { test } from "node:test";
import type { GhClient, GhResponse } from "./client.ts";
import { matchesPath, readMergeConditions } from "./merge-conditions.ts";

function fakeGh(routes: Record<string, GhResponse<unknown>>): GhClient & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async get<T>(path: string) {
      paths.push(path);
      const r = routes[path];
      if (!r) return { kind: "error", status: 404, message: "Not Found" } as GhResponse<T>;
      return r as GhResponse<T>;
    },
  };
}

const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });
const RULES = "repos/acme/api/rules/branches/main";
const PROT = "repos/acme/api/branches/main/protection";
const files = (page: number) => `repos/acme/api/pulls/40/files?per_page=100&page=${page}`;
const A = { repo: "acme/api", base: "main", pr: 40, protectedPaths: ["infra/", "deploy/**", "*.tf"] };

const STRICT_RULES = [
  { type: "pull_request", parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true } },
  { type: "required_status_checks", parameters: { required_status_checks: [{ context: "unit" }], strict_required_status_checks_policy: true } },
];

test("rulesets that enforce all four allow auto-merge", async () => {
  const gh = fakeGh({ [RULES]: ok(STRICT_RULES), [files(1)]: ok([{ filename: "src/app.ts" }]) });
  const r = await readMergeConditions(gh, A);
  assert.ok(r.kind === "read");
  assert.deepEqual(
    r.conditions.map((c) => c.ok),
    [true, true, true, true],
  );
  assert.equal(r.autoMerge, true);
});

test("classic protection the token cannot read counts as false with the reason", async () => {
  const gh = fakeGh({
    [RULES]: ok([]),
    [PROT]: { kind: "error", status: 403, message: "Resource not accessible by integration" },
    [files(1)]: ok([]),
  });
  const r = await readMergeConditions(gh, A);
  assert.ok(r.kind === "read");
  assert.equal(r.autoMerge, false);
  assert.match(r.conditions[0]?.reason ?? "", /unreadable: branch protection/);
});

test("classic protection alone can satisfy the settings conditions", async () => {
  const gh = fakeGh({
    [RULES]: ok([]),
    [PROT]: ok({
      required_pull_request_reviews: { required_approving_review_count: 2, dismiss_stale_reviews: true },
      required_status_checks: { strict: true, contexts: ["unit"] },
    }),
    [files(1)]: ok([]),
  });
  const r = await readMergeConditions(gh, A);
  assert.ok(r.kind === "read" && r.autoMerge);
});

test("a merge queue stands in for the up-to-date rule", async () => {
  const rules = [STRICT_RULES[0], { type: "required_status_checks", parameters: { required_status_checks: [{ context: "unit" }] } }, { type: "merge_queue" }];
  const r = await readMergeConditions(fakeGh({ [RULES]: ok(rules), [files(1)]: ok([]) }), A);
  assert.ok(r.kind === "read");
  assert.deepEqual(r.conditions[1], { id: "up_to_date_or_queue", ok: true, reason: "merge queue" });
});

test("a PR touching a protected path, on any page or by rename, is not auto-merged", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `src/f${i}.ts` }));
  const gh = fakeGh({
    [RULES]: ok(STRICT_RULES),
    [files(1)]: ok(page1),
    [files(2)]: ok([{ filename: "src/moved.ts", previous_filename: "infra/main.ts" }]),
  });
  const r = await readMergeConditions(gh, A);
  assert.ok(r.kind === "read");
  assert.deepEqual(r.conditions[3], { id: "no_protected_paths", ok: false, reason: "touches protected path infra/main.ts" });
  assert.equal(r.autoMerge, false);
});

test("an unreadable protected_paths setting is false without reading the PR", async () => {
  const gh = fakeGh({ [RULES]: ok(STRICT_RULES) });
  const r = await readMergeConditions(gh, { ...A, protectedPaths: null });
  assert.ok(r.kind === "read" && !r.autoMerge);
  assert.deepEqual(r.conditions[3], { id: "no_protected_paths", ok: false, reason: "protected_paths unreadable" });
  assert.ok(!gh.paths.some((p) => p.includes("/files")));
});

test("rate limiting anywhere returns rate_limited, not a verdict", async () => {
  const gh = fakeGh({ [RULES]: { kind: "rate_limited", resource: "core", resetAt: 99 } });
  assert.deepEqual(await readMergeConditions(gh, A), { kind: "rate_limited", resetAt: 99 });
});

test("matchesPath: subtree, one segment and any depth", () => {
  assert.equal(matchesPath("infra/", "infra/a/b.tf"), true);
  assert.equal(matchesPath("infra/", "infrastructure.md"), false);
  assert.equal(matchesPath("deploy/**", "deploy/prod/x.yaml"), true);
  assert.equal(matchesPath("*.tf", "main.tf"), true);
  assert.equal(matchesPath("*.tf", "infra/main.tf"), false);
  assert.equal(matchesPath("**/*.tf", "infra/main.tf"), true);
  assert.equal(matchesPath("**/*.tf", "main.tf"), true);
  assert.equal(matchesPath("deploy/**", "deployment.md"), false);
  assert.equal(matchesPath("a.b", "aXb"), false);
  assert.equal(matchesPath(".github/workflows/*.yml", ".github/workflows/ci.yml"), true);
});
