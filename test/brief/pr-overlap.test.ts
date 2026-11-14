import assert from "node:assert/strict";
import { test } from "node:test";
import { type GhClient, type GhResponse, overlapLines, prOverlaps, Store } from "../../core/index.ts";
import { readyText } from "../../claude-plugin/mcp/resources/ready.ts";

// Decision 252 (B5): open PRs of a watched repository that change the same file are named on the
// lead's ready read, computed when it is read from the PRs' file lists, so the land order is planned
// before a merge makes the second one conflict. Nothing is stored or sent.

const REPO = "acme/api";
/** GitHub is asked under the spelling watch.repos gives; stored refs are lowercase. */
const GIVEN = "Acme/Api";
const FILES = (n: number) => `repos/${GIVEN}/pulls/${n}/files?per_page=100&page=1`;
const ok = (data: unknown): GhResponse<unknown> => ({ kind: "ok", status: 200, data });

function world() {
  const store = Store.open({ path: ":memory:" });
  const routes = new Map<string, GhResponse<unknown>>();
  const reads: string[] = [];
  const gh: GhClient = {
    get: async <T>(path: string) => {
      reads.push(path);
      return (routes.get(path) ?? { kind: "error", status: 404, message: "Not Found" }) as GhResponse<T>;
    },
  };
  /** An open PR n as pr-monitor recorded it, changing `files` on GitHub. */
  const open = (n: number, files: string[], base = "main") => {
    store.append({ type: "pr_opened", source: "pr-monitor", dedupe_key: `pr_opened:${REPO}#${n}`, payload: { pr: `${REPO}#${n}`, task: `task_${n}`, base, head_sha: "a".repeat(40), head: `feature-${n}` } });
    routes.set(FILES(n), ok(files.map((filename) => ({ filename }))));
  };
  const read = () => prOverlaps({ events: store.events(), gh, repos: [GIVEN] });
  return { store, routes, reads, open, read };
}

test("two open PRs sharing CHANGELOG.md and docs/decisions.md: one overlap line naming both PRs and both files", async () => {
  const w = world();
  w.open(1, ["CHANGELOG.md", "docs/decisions.md", "core/a.ts"]);
  w.open(2, ["docs/decisions.md", "CHANGELOG.md", "core/b.ts"]);
  const r = await w.read();
  assert.deepEqual(r.overlaps, [{ prs: ["acme/api#1", "acme/api#2"], files: ["CHANGELOG.md", "docs/decisions.md"] }]);
  const lines = overlapLines(r);
  const pair = lines.filter((l) => l.includes("acme/api#1") && l.includes("acme/api#2"));
  assert.equal(pair.length, 1, lines.join("\n"));
  for (const f of ["CHANGELOG.md", "docs/decisions.md"]) assert.ok(pair[0]?.includes(f), pair[0]);
  for (const f of ["core/a.ts", "core/b.ts"]) assert.ok(!lines.join("\n").includes(f), `${f} is not shared`);
});

test("disjoint PRs: no overlap line", async () => {
  const w = world();
  w.open(1, ["core/a.ts"]);
  w.open(2, ["core/b.ts"]);
  const r = await w.read();
  assert.deepEqual(r, { overlaps: [], unseen: [] });
  assert.deepEqual(overlapLines(r), []);
});

test("different base branches do not pair", async () => {
  const w = world();
  w.open(1, ["CHANGELOG.md"]);
  w.open(2, ["CHANGELOG.md"], "release");
  const r = await w.read();
  assert.deepEqual(r.overlaps, []);
  assert.deepEqual(w.reads, [], "a base with one open PR reads no file list");
});

test("a renamed file counts under both its paths", async () => {
  const w = world();
  w.open(1, ["docs/old.md"]);
  w.open(2, []);
  w.routes.set(FILES(2), ok([{ filename: "docs/new.md", previous_filename: "docs/old.md" }]));
  const r = await w.read();
  assert.deepEqual(r.overlaps, [{ prs: ["acme/api#1", "acme/api#2"], files: ["docs/old.md"] }]);
});

test("an unread file list judges no pair of that PR and names it in unseen", async () => {
  const w = world();
  w.open(1, ["CHANGELOG.md"]);
  w.open(2, ["CHANGELOG.md"]);
  w.open(3, ["CHANGELOG.md"]);
  w.routes.set(FILES(2), { kind: "error", status: 502, message: "Bad Gateway" });
  const r = await w.read();
  assert.deepEqual(r.overlaps, [{ prs: ["acme/api#1", "acme/api#3"], files: ["CHANGELOG.md"] }]);
  assert.equal(r.unseen.length, 1);
  assert.match(r.unseen[0] ?? "", /acme\/api#2/);
  assert.ok(overlapLines(r).some((l) => l.includes("acme/api#2") && l.includes("판정하지 못")), overlapLines(r).join("\n"));
});

test("one open PR or none: no GitHub file read", async () => {
  const w = world();
  assert.deepEqual(await w.read(), { overlaps: [], unseen: [] });
  w.open(1, ["CHANGELOG.md"]);
  // A merged or closed PR is not open: it pairs with nothing.
  w.open(2, ["CHANGELOG.md"]);
  w.store.append({ type: "pr_merged", source: "pr-monitor", dedupe_key: `pr_merged:${REPO}#2`, payload: { pr: `${REPO}#2`, merge_sha: "b".repeat(40) } });
  w.open(3, ["CHANGELOG.md"]);
  w.store.append({ type: "pr_closed", source: "pr-monitor", dedupe_key: `pr_closed:${REPO}#3`, payload: { pr: `${REPO}#3` } });
  assert.deepEqual(await w.read(), { overlaps: [], unseen: [] });
  assert.deepEqual(w.reads, []);
});

test("three PRs overlapping each other: one line per pair, no pair twice", async () => {
  const w = world();
  for (const n of [3, 1, 2]) w.open(n, ["CHANGELOG.md"]);
  const r = await w.read();
  assert.deepEqual(
    r.overlaps.map((o) => o.prs.join(" ")),
    ["acme/api#1 acme/api#2", "acme/api#1 acme/api#3", "acme/api#2 acme/api#3"],
  );
  assert.equal(overlapLines(r).filter((l) => l.includes("↔")).length, 3);
  assert.deepEqual(w.reads.sort(), [FILES(1), FILES(2), FILES(3)].sort(), "each list read once");
});

test("the ready read shows the overlap section after the items", async () => {
  const w = world();
  w.open(1, ["CHANGELOG.md"]);
  w.open(2, ["CHANGELOG.md"]);
  const text = readyText({ events: [], orca: { tasks: [], gates: [] }, now: "2026-11-14T12:00:00Z" } as never, await w.read());
  assert.match(text, /겹침/);
  assert.match(text, /acme\/api#1 ↔ acme\/api#2/);
  assert.ok(text.indexOf("준비된 항목 없음") < text.indexOf("겹침"));
});
