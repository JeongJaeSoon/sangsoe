// Decision 240: resource_record also takes what only the owner clears (a checkout, a registration, a
// branch, a file, a process). The 리소스 section lists them as 기록됨·오너 손; REAPER never takes them.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { type Exec, readResourcePart, recordResource, type ReapReport, type ResourceDeps, Store } from "../../core/index.ts";
import { scratchDir } from "../scratch.ts";
import { assertNeverForbidden, dropScratch, finishedCard, rounds, world } from "./harness.ts";

after(dropScratch);

const NOW = Date.parse("2026-11-14T12:00:00Z");

function deps(store: Store): ResourceDeps {
  const exec: Exec = async (file, args) => {
    if (file === "du") return { code: 0, stdout: args.slice(1).map((p) => `8\t${p}`).join("\n"), stderr: "" };
    if (file === "ps") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected ${file}`);
  };
  const empty = { ok: true, value: { rows: [], nonLocal: { rows: 0, hostIds: [], ids: [] }, omittedHostIds: [], truncated: false } };
  return {
    orca: { worktreeList: async () => empty, worktreePs: async () => empty, diagnosticsMemory: async () => ({ ok: true, value: {} }) } as unknown as ResourceDeps["orca"],
    exec,
    events: (f) => store.events(f),
    now: () => NOW,
    sample: () => ({}),
    plan: async () => ({ roots_ok: true, mark_only: false, unseen: [], judged: [] }) as unknown as ReapReport,
    tmpRoot: scratchDir("res240-tmp-"),
    uid: process.getuid?.() ?? 0,
    trashBin: null,
  };
}

const recordedOf = async (store: Store) => {
  const made = await readResourcePart(deps(store), "made");
  assert.equal(made.part, "made");
  return made.part === "made" ? made.made.recorded.map(({ kind, ref, owner }) => ({ kind, ref, owner })) : [];
};

test("a checkout the owner records is listed under the made part, and leaves it once released", async () => {
  const store = Store.open({ path: ":memory:" });
  const r = recordResource(store, { kind: "checkout", ref: "/tmp/x checkout", owner: "task_a" });
  assert.ok(r.ok, r.ok ? "" : r.refusal.reason);
  assert.deepEqual(await recordedOf(store), [{ kind: "checkout", ref: "/tmp/x checkout", owner: "task_a" }]);
  const made = await readResourcePart(deps(store), "made");
  assert.ok(made.part === "made" && made.made.recorded[0]?.since, "the row says since when");

  assert.equal(recordResource(store, { kind: "checkout", ref: "/tmp/x checkout", owner: "task_b", action: "released" }).ok, false, "only its owner releases it");
  assert.ok(recordResource(store, { kind: "checkout", ref: "/tmp/x checkout", owner: "task_a", action: "released" }).ok);
  assert.deepEqual(await recordedOf(store), []);
  assert.ok(recordResource(store, { kind: "checkout", ref: "/tmp/x checkout", owner: "task_a" }).ok, "made again, recorded again");
  assert.equal((await recordedOf(store)).length, 1);
  store.close();
});

test("every owner kind is taken; two owners of one ref are two rows; a worktree is still refused", async () => {
  const store = Store.open({ path: ":memory:" });
  for (const kind of ["checkout", "registration", "branch", "file", "process"]) {
    const r = recordResource(store, { kind, ref: `${kind}-1`, owner: "task_a" });
    assert.ok(r.ok, `${kind}: ${r.ok ? "" : r.refusal.reason}`);
  }
  assert.ok(recordResource(store, { kind: "branch", ref: "branch-1", owner: "task_b" }).ok);
  const rows = await recordedOf(store);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.filter((x) => x.ref === "branch-1").map((x) => x.owner).sort(), ["task_a", "task_b"]);
  assert.equal(store.events({ type: "reap_blocked" }).length, 0, "a shared owner-kind ref is not contested: nothing sweeps it");

  const w = recordResource(store, { kind: "worktree", ref: "inst-1", owner: "task_a" });
  assert.equal(w.ok, false, "a worktree row would make a card REAPER's to take");
  assert.equal(recordResource(store, { kind: "printer", ref: "p", owner: "task_a" }).ok, false);
  store.close();
});

test("REAPER takes no owner-kind row: a finished card's rounds touch none and close none", async () => {
  const w = world();
  finishedCard(w, "keeper");
  for (const [kind, ref] of [
    ["checkout", "/tmp/x-checkout"],
    ["registration", "repo-x"],
    ["branch", "feat/x"],
    ["file", "/tmp/x file.txt"],
    ["process", "4242"],
  ] as const) {
    assert.ok(recordResource(w.store, { kind, ref, owner: "inst-keeper" }).ok);
  }
  await rounds(w, 3);
  const owned = new Set(["checkout", "registration", "branch", "file", "process"]);
  assert.deepEqual(w.types("reap_blocked").filter((p) => owned.has(String(p.kind))), []);
  assert.deepEqual(w.types("reap_done").filter((p) => owned.has(String(p.kind))), []);
  assert.deepEqual(w.store.events({ type: "resource" }).filter((e) => e.source !== "resource_record"), [], "REAPER closes no owner-kind hold");
  assert.deepEqual(w.docker.calls.filter((c) => / (inspect|rm) /.test(c)), []);
  assert.equal((await recordedOf(w.store)).length, 5, "still the owner's after the card is gone");
  assertNeverForbidden(w);
});
