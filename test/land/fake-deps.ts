import { dedupeKey, EVENTS, type GhClient, type GhResponse, type LandDeps, Store } from "../../core/index.ts";

// One fake world shared by the function call and both entrance fixtures in this folder: a fake
// GitHub (routes the test sets), an in-memory store and a merge port that records its calls.

export const REPO = "acme/api";
export const PR = "acme/api#12";
export const HEAD = "a".repeat(40);

export const world: { routes: Record<string, GhResponse<unknown>>; merges: unknown[]; store: Store } = {
  routes: {},
  merges: [],
  store: Store.open({ path: ":memory:" }),
};

const gh: GhClient = {
  async get<T>(path: string) {
    return (world.routes[path] ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T>;
  },
};

export const fakeDeps = (): LandDeps => ({
  gh,
  openStore: () => ({ events: () => world.store.events(), append: (e) => world.store.append(e), close: () => {} }),
  merge: async (a) => {
    world.merges.push(a);
    return { ok: true, message: "auto-merge enabled" };
  },
  config: () => ({
    tier: { docs_globs: ["docs/"], test_globs: ["test/"], ui_globs: [], v3_globs: [], protected_paths: [], owners: [] },
    protectedPaths: [],
  }),
});

const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });

/** A fresh world: PR 12 open at HEAD, one changed source file, rulesets that allow auto-merge. */
export function reset(files: unknown[] = [{ filename: "core/a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }]): void {
  world.store = Store.open({ path: ":memory:" });
  world.merges = [];
  world.routes = {
    [`repos/${REPO}/pulls/12`]: ok({ state: "open", head: { sha: HEAD }, base: { ref: "main" }, user: { login: "alice" }, labels: [] }),
    [`repos/${REPO}/pulls/12/files?per_page=100&page=1`]: ok(files),
    [`repos/${REPO}/rules/branches/main`]: ok([
      { type: "pull_request", parameters: { required_approving_review_count: 1, dismiss_stale_reviews_on_push: true } },
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "unit" }], strict_required_status_checks_policy: true } },
    ]),
  };
}

export function reviewed(): void {
  world.store.append({
    type: "review_verdict",
    source: "review record",
    actor: "codex",
    dedupe_key: dedupeKey(EVENTS.review_verdict, PR, HEAD, "codex"),
    payload: { pr: PR, head_sha: HEAD, act_on: 0, reviewer: "codex", author: "alice" },
  });
}

export function evidence(kind: string): void {
  world.store.append({ type: "evidence", source: "test", subject: PR, actor: "worker:u11", payload: { kind, head_sha: HEAD, exit_code: 0, not_verified: ["prod"] } });
}
