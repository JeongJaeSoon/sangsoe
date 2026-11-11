// Decision 201: a worker_dead written on a Dispatch raises its Task's 🚨, and the author's reply that
// GitHub dates after the newest review comment clears that comment's 🚨.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type BriefInput, type BriefSnapshot, itemFacts, replayJsonl } from "../../core/index.ts";

const FIX = new URL("../fixtures/brief/", import.meta.url);
const NOW = "2026-11-10T12:00:00.000Z";
const base = readFileSync(new URL("sample.events.jsonl", FIX), "utf8");
const orca = JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot;
const line = (ts: string, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ts, type, source: "test", payload, ...extra });
const withEvents = (...lines: string[]): BriefInput => ({ events: replayJsonl(`${base}\n${lines.join("\n")}\n`), orca, now: NOW });
const alarms = (...lines: string[]) => [...(itemFacts(withEvents(...lines)).find((f) => f.alias === "i026")?.alarms ?? [])];
const quiet = alarms();

test("a worker_dead on a Dispatch is its Task's alarm: by the row's target, else the Task Orca runs it on", () => {
  // As orca-monitor writes it: the Task in `target`.
  const monitored = line("2026-11-10T11:00:00.000Z", "worker_dead", { reason: "terminal_gone" }, { entity: "dispatch", entity_id: "ctx_x", target: "task_26" });
  assert.deepEqual(alarms(monitored), [...quiet, "worker_dead"]);
  // As a failed start writes it: no target; the snapshot's activeDispatchId names the Task.
  const started = line("2026-11-10T11:00:00.000Z", "worker_dead", { reason: "start_failed" }, { entity: "dispatch", entity_id: "ctx_26" });
  assert.deepEqual(alarms(started), [...quiet, "worker_dead"]);
  const unknown = line("2026-11-10T11:00:00.000Z", "worker_dead", { reason: "start_failed" }, { entity: "dispatch", entity_id: "ctx_nobody" });
  assert.deepEqual(alarms(unknown), quiet);
});

test("the author's reply GitHub dates after the newest review comment clears review_commented", () => {
  const comment = (at?: string) => line("2026-11-10T11:01:00.000Z", "review_commented", { pr: "acme/api#40", reviewer: "bob", ...(at ? { at } : {}) });
  // Stored before the comment in the same round, as pr-monitor's newest-first comment list does.
  const reply = (at: string) => line("2026-11-10T11:00:00.000Z", "review_replied", { pr: "acme/api#40", by: "w-api-1", at });
  assert.deepEqual(alarms(reply("2026-11-10T10:30:00Z"), comment("2026-11-10T10:00:00Z")), quiet, "answered");
  assert.deepEqual(alarms(reply("2026-11-10T09:30:00Z"), comment("2026-11-10T10:00:00Z")), [...quiet, "review_commented"], "the reply is older");
  assert.deepEqual(alarms(reply("2026-11-10T10:30:00Z"), comment()), [...quiet, "review_commented"], "a comment without GitHub's time stays");
  assert.deepEqual(
    alarms(reply("2026-11-10T10:30:00Z"), comment("2026-11-10T10:00:00Z"), comment("2026-11-10T10:45:00Z")),
    [...quiet, "review_commented"],
    "a newer comment is not answered yet",
  );
});
