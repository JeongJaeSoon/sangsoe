import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createGhClient,
  DEFAULT_MONITOR_CONFIG,
  type Exec,
  type GhCache,
  type MonitorDeps,
  memoryGhCache,
  nullChatProvider,
  type OrcaAdapter,
  runMonitor,
  Store,
} from "../../core/index.ts";

const REPO = "acme/api";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const recorded = JSON.parse(readFileSync(new URL("../fixtures/github/pr-reviews.json", import.meta.url), "utf8")) as {
  events: unknown[];
  reviews: unknown[];
  comments: { id: number }[];
};
const EVENTS = `repos/${REPO}/issues/7/events?per_page=100`;
const REVIEWS = `repos/${REPO}/pulls/7/reviews?per_page=100`;
const COMMENTS = `repos/${REPO}/pulls/7/comments?sort=created&direction=desc&per_page=100`;
const REVIEW_PATHS = [EVENTS, REVIEWS, COMMENTS];
const REVIEW_TYPES = ["pr_review_requested", "pr_changes_requested", "review_commented", "review_replied"];

const pull = { number: 7, merged_at: null, user: { login: "alice" }, head: { sha: "a".repeat(40), ref: "feature-7", repo: { full_name: REPO } }, base: { ref: "main" }, labels: [] };

/** `gh api -i` over a route table: 304 when If-None-Match names the route's current ETag. */
function fakeGh() {
  const routes = new Map<string, { etag: string; body: unknown }>([
    [`repos/${REPO}/pulls?state=open&per_page=100`, { etag: '"open1"', body: [pull] }],
    [EVENTS, { etag: '"ev1"', body: recorded.events }],
    [REVIEWS, { etag: '"rv1"', body: recorded.reviews }],
    [COMMENTS, { etag: '"cm1"', body: recorded.comments }],
  ]);
  const log: string[] = [];
  const exec: Exec = async (_file, args) => {
    const path = args.at(-1) ?? "";
    const h = args.indexOf("-H");
    const sent = h >= 0 ? args[h + 1]?.replace(/^If-None-Match: /, "") : undefined;
    const route = routes.get(path);
    const head = "x-ratelimit-limit: 5000\nx-ratelimit-remaining: 4900\nx-ratelimit-reset: 9999999999\n";
    if (!route) return { code: 1, stdout: `HTTP/2.0 404 Not Found\n${head}\n{"message":"Not Found"}`, stderr: "" };
    if (sent === route.etag) {
      log.push(`304 ${path}`);
      return { code: 1, stdout: `HTTP/2.0 304 Not Modified\nEtag: ${route.etag}\n${head}\n`, stderr: "" };
    }
    log.push(`200 ${path}`);
    return { code: 0, stdout: `HTTP/2.0 200 OK\nEtag: ${route.etag}\n${head}\n${JSON.stringify(route.body)}`, stderr: "" };
  };
  return { routes, log, exec };
}

function world(gh = fakeGh(), cache: GhCache = memoryGhCache()) {
  const store = Store.open({ path: ":memory:" });
  const orca = {
    referenceFind: async () => ({ ok: true, value: { matches: [] } }),
    worktreeList: async () => ({ ok: true, value: { rows: [], nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false } }),
  } as unknown as OrcaAdapter;
  const deps: MonitorDeps = {
    orca,
    exec: gh.exec,
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    now: () => NOW,
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({}),
    gh: createGhClient({ exec: gh.exec, cache, now: () => NOW }),
    ghBudget: () => cache.budget("core"),
    watch: () => ({ repos: [REPO], authors: [], linkedOnly: false, owners: [] }),
    tier: () => ({ docs_globs: [], test_globs: [], ui_globs: [], v3_globs: [], protected_paths: [], owners: [] }),
    core: { store, orca },
  };
  const reviewRows = () => store.events().filter((e) => REVIEW_TYPES.includes(e.type));
  return { store, gh, cache, round: () => runMonitor("pr", deps), reviewRows };
}

test("pr-monitor writes the review facts by GitHub id with no text, once: the next round's 304s write nothing", async () => {
  const w = world();
  const first = await w.round();
  assert.deepEqual(
    w.reviewRows().map((e) => [e.type, e.dedupe_key, e.payload]),
    [
      ["pr_review_requested", "pr_review_requested:acme%2Fapi%237:1002", { pr: "acme/api#7", reviewer: "team:code-reviewers" }],
      ["pr_review_requested", "pr_review_requested:acme%2Fapi%237:1003", { pr: "acme/api#7", reviewer: "bob" }],
      ["pr_changes_requested", "pr_changes_requested:acme%2Fapi%237:2001", { pr: "acme/api#7", reviewer: "bob" }],
      ["review_replied", "review_replied:acme%2Fapi%237:3002", { pr: "acme/api#7", by: "alice" }],
      ["review_commented", "review_commented:acme%2Fapi%237:3001", { pr: "acme/api#7", reviewer: "review-bot" }],
    ],
  );
  assert.ok(!first.unseen.some((u) => REVIEW_PATHS.some((p) => u.includes(p))), first.unseen.join("; "));

  w.gh.log.length = 0;
  const again = await w.round();
  assert.deepEqual(again.written.filter((x) => REVIEW_TYPES.includes(x.type)), [], "the second round writes nothing");
  assert.deepEqual(w.gh.log.filter((l) => REVIEW_PATHS.some((p) => l.endsWith(p))), REVIEW_PATHS.map((p) => `304 ${p}`));
  assert.ok(!again.unseen.some((u) => REVIEW_PATHS.some((p) => u.includes(p))), "a 304 is not an unread list");

  // A new comment changes the list's ETag: the whole page is read again and only the new id is written.
  w.gh.routes.set(COMMENTS, { etag: '"cm2"', body: [{ id: 3003, user: { login: "carol" }, in_reply_to_id: null }, ...recorded.comments] });
  const third = await w.round();
  assert.deepEqual(third.written.filter((x) => REVIEW_TYPES.includes(x.type)).map((x) => x.dedupe_key), ["review_commented:acme%2Fapi%237:3003"]);
});

test("a lost database's reread reads the review lists without the ETag the lost rows were judged under", async () => {
  const gh = fakeGh();
  const cache = memoryGhCache();
  await world(gh, cache).round();

  // Same runner, so the same ETags; the database is new.
  const lost = world(gh, cache);
  await lost.round();
  assert.equal(lost.reviewRows().length, 0, "without the rebuilt signal the 304s hide every fact");

  const rebuilt = world(gh, cache);
  rebuilt.store.append({ type: "signal", source: "store", payload: { kind: "store_rebuilt", reason: "test" } });
  await rebuilt.round();
  assert.equal(rebuilt.reviewRows().length, 5);
});

test("an oldest-first list that fills its page is reported unread past it", async () => {
  const w = world();
  w.gh.routes.set(REVIEWS, { etag: '"rv100"', body: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, state: "COMMENTED", user: { login: "bob" } })) });
  const r = await w.round();
  assert.ok(r.unseen.includes("acme/api#7: reviews past the first 100"), r.unseen.join("; "));
});
