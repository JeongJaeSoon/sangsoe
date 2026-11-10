import assert from "node:assert/strict";
import { test } from "node:test";
import { reap } from "../../cli/commands/reap.ts";
import {
  type Exec,
  parseReaperConfig,
  type ReapReport,
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

test("the reaper config: no section is null (mark only), malformed protect is null, minutes become ms", () => {
  assert.equal(parseReaperConfig({}), null);
  assert.equal(parseReaperConfig({ reaper: { protect: "x" } }), null);
  assert.deepEqual(parseReaperConfig({ reaper: { protect: ["keep-me"], grace_minutes: 60, min_gap_minutes: 90 } }), {
    protect: ["keep-me"],
    graceMs: 3_600_000,
    minGapMs: 3_600_000,
  });
});
