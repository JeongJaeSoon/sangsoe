import assert from "node:assert/strict";
import { test } from "node:test";
import { reap } from "../../cli/commands/reap.ts";
import {
  type Exec,
  type OwnerReap,
  type OwnerReaped,
  parseReaperConfig,
  type ReapReport,
  type ResourceView,
  recordResource,
  resourceRecord,
  Store,
} from "../../core/index.ts";
import { expectSameViaBothEntrances } from "../boundaries/both-entrances.ts";

test("resource_record and `sangsoe resource record` refuse the same way and write nothing", async () => {
  const out = await expectSameViaBothEntrances({
    tool: "resource_record",
    input: { owner: "task_1", kind: "process", ref: "4242" },
    argv: ["resource", "record", "--owner", "task_1", "--kind", "process", "--ref", "4242"],
  });
  assert.equal(out.ok, false);
  assert.match(out.ok ? "" : out.refusal.reason, /REAPER sweeps only container, volume, network, image/);
});

test("recordResource writes one resource row per id, and the same id twice is one row", () => {
  const store = Store.open({ path: ":memory:" });
  const a = recordResource(store, { kind: "volume", ref: "api_data", owner: "inst-1" });
  const b = recordResource(store, { kind: "volume", ref: "api_data", owner: "inst-1" });
  assert.ok(a.ok && b.ok);
  assert.equal(a.value.inserted, true);
  assert.equal(b.value.inserted, false);
  assert.deepEqual(
    store.events({ type: "resource" }).map((e) => e.payload),
    [{ action: "created", kind: "volume", owner: "inst-1", ref: "api_data" }],
  );
  assert.equal(recordResource(store, { kind: "image", ref: " ", owner: "inst-1" }).ok, false);
  store.close();
});

test("a compose project records its containers, named volumes and default network, by project name", async () => {
  const calls: string[] = [];
  const exec: Exec = async (_f, args) => {
    calls.push(args.join(" "));
    const out: Record<string, string> = { ps: "aaa\nbbb\n", config: "data\n" };
    return { code: 0, stdout: out[args[3] ?? ""] ?? "", stderr: "" };
  };
  const store = Store.open({ path: ":memory:" });
  const r = await resourceRecord(store, exec, { owner: "task_9", compose: "api" });
  assert.ok(r.ok);
  assert.deepEqual(
    r.value.recorded.map((x) => `${x.kind}:${x.ref}`),
    ["container:aaa", "container:bbb", "volume:api_data", "network:api_default"],
  );
  assert.ok(calls.every((c) => c.startsWith("compose -p api ") && !/label|filter/.test(c)));
  assert.equal((await resourceRecord(store, exec, { owner: "t", compose: "api", kind: "volume" })).ok, false);
  store.close();
});

test("`sangsoe reap run` passes --dry-run and --mark-only through, and refuses other verbs", async () => {
  const seen: unknown[] = [];
  const fake = (o: { dryRun: boolean }) => ({
    run: async (opts?: unknown) => {
      seen.push({ ...o, ...(opts as object) });
      return { round: 1 } as ReapReport;
    },
    close: () => {},
  });
  const r = await reap(["run"], { "dry-run": true, "mark-only": true }, fake);
  assert.ok(r.ok);
  assert.deepEqual(seen, [{ dryRun: true, trigger: "hint", markOnly: true }]);
  const bad = await reap(["sweep"], {}, fake);
  assert.equal(bad.ok, false);
});

test("decision 234: `sangsoe reap plan` reads, `run --only` / `--tmp` hand the named ids to the confirmed 정리", async () => {
  const asked: unknown[] = [];
  const res = () => ({
    read: async () => {
      asked.push("read");
      return {} as ResourceView;
    },
    reap: async (a: OwnerReap) => {
      asked.push(a);
      return { reaped: [], blocked: [], skipped: [], tmp: null } as OwnerReaped;
    },
  });
  const noRound = () => {
    throw new Error("no plain round expected");
  };
  assert.ok((await reap(["plan"], {}, noRound, res)).ok);
  assert.ok((await reap(["run"], { only: "inst-a, inst-b" }, noRound, res)).ok);
  assert.ok((await reap(["run"], { tmp: true }, noRound, res)).ok);
  assert.deepEqual(asked, ["read", { worktrees: ["inst-a", "inst-b"], tmp: false }, { worktrees: [], tmp: true }]);
  for (const values of [{ only: "" }, { only: "a b;rm" }, { only: "inst-a", "dry-run": true }]) {
    assert.equal((await reap(["run"], values, noRound, res)).ok, false, JSON.stringify(values));
  }
  assert.equal(asked.length, 3, "a refused call reaches nothing");
});

test("the reaper config: no section is absent (mark only), a malformed one is unreadable, minutes become ms", () => {
  assert.deepEqual(parseReaperConfig({}), { kind: "absent" });
  // Decision 201: a section that is there but cannot be read is not "no config".
  for (const raw of [{ reaper: { protect: "x" } }, { reaper: {} }, { reaper: null }, { reaper: [] }, null, []]) {
    assert.equal(parseReaperConfig(raw).kind, "unreadable", JSON.stringify(raw));
  }
  assert.deepEqual(parseReaperConfig({ reaper: { protect: ["keep-me"], grace_minutes: 60, min_gap_minutes: 90 } }), {
    kind: "ok",
    config: { protect: ["keep-me"], graceMs: 3_600_000, minGapMs: 3_600_000 },
  });
});
