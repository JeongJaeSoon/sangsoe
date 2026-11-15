// Decision 237: a stop on a lost login reads as one in the brief and on the owner's list, with the
// recovery that works (sign in once, then restart each stopped session with claude --continue).
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type BriefInput, type BriefSnapshot, itemFacts, ownerTodoFrom, panelView, renderMarkdown, replayJsonl } from "../../core/index.ts";
import { later, ownerWorld, T0 } from "../owner/world.ts";

const FIX = new URL("../fixtures/brief/", import.meta.url);
const NOW = "2026-11-10T12:00:00.000Z";
const base = readFileSync(new URL("sample.events.jsonl", FIX), "utf8");
const orca = JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot;
const line = (ts: string, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ts, type, source: "test", payload, ...extra });
const withEvents = (...lines: string[]): BriefInput => ({ events: replayJsonl(`${base}\n${lines.join("\n")}\n`), orca, now: NOW });
const alarms = (input: BriefInput) => [...(itemFacts(input).find((f) => f.alias === "i026")?.alarms ?? [])];
const dead = (payload: Record<string, unknown>) =>
  line("2026-11-10T11:00:00.000Z", "worker_dead", payload, { entity: "dispatch", entity_id: "ctx_x", target: "task_26" });

test("237: a stop_failure with cause auth is its own alarm and names the sign-in recovery", () => {
  const quiet = alarms(withEvents());
  assert.deepEqual(alarms(withEvents(dead({ reason: "stop_failure", cause: "auth" }))), [...quiet, "worker_dead:auth"]);
  assert.deepEqual(alarms(withEvents(dead({ reason: "stop_failure" }))), [...quiet, "worker_dead"], "another stop keeps the plain alarm");
  const v = panelView(withEvents(dead({ reason: "stop_failure", cause: "auth" })), {});
  assert.ok(v.ok, JSON.stringify(v));
  assert.match(renderMarkdown(v.value.model), /\| 🚨 재로그인 \|/);
});

test("237: an auth stop after an idle turn says 재로그인, not that the worker waits for orders", () => {
  const idle = line("2026-11-10T10:30:00.000Z", "worker_idle", { session: "s1" }, { entity: "task", entity_id: "task_26" });
  const v = panelView(withEvents(idle, dead({ reason: "stop_failure", cause: "auth" })), {});
  assert.ok(v.ok, JSON.stringify(v));
  const md = renderMarkdown(v.value.model);
  assert.match(md, /\| 🚨 재로그인 \|/);
  assert.doesNotMatch(md, /🚨 워커가 지시를 기다림/);
});

test("237: a finished turn after the auth stop means the session signed in again: 재로그인 is gone", () => {
  const idle = line("2026-11-10T11:30:00.000Z", "worker_idle", { session: "s1" }, { entity: "task", entity_id: "task_26" });
  const quiet = alarms(withEvents());
  assert.deepEqual(alarms(withEvents(dead({ reason: "stop_failure", cause: "auth" }), idle)), quiet);
  const v = panelView(withEvents(dead({ reason: "stop_failure", cause: "auth" }), idle), {});
  assert.ok(v.ok, JSON.stringify(v));
  assert.doesNotMatch(renderMarkdown(v.value.model), /재로그인/);
});

test("237: the newer of an auth stop and another stop of the same item is the one shown", () => {
  const quiet = alarms(withEvents());
  const at = (ts: string, payload: Record<string, unknown>) => line(ts, "worker_dead", payload, { entity: "dispatch", entity_id: "ctx_x", target: "task_26" });
  const authThenGone = withEvents(at("2026-11-10T11:00:00.000Z", { reason: "stop_failure", cause: "auth" }), at("2026-11-10T11:30:00.000Z", { reason: "terminal_gone" }));
  assert.deepEqual(alarms(authThenGone), [...quiet, "worker_dead"]);
  const goneThenAuth = withEvents(at("2026-11-10T11:00:00.000Z", { reason: "stop_failure" }), at("2026-11-10T11:30:00.000Z", { reason: "stop_failure", cause: "auth" }));
  assert.deepEqual(alarms(goneThenAuth), [...quiet, "worker_dead:auth"]);
});

test("237: a stale wait on a lost login tells the owner what to do, not the terminal's last words", () => {
  const w = ownerWorld();
  const wait = w.store.append({ type: "waiting_human", source: "StopFailure", payload: { session: "sess_lead", cause: "auth", excerpt: "API Error: 403" } });
  w.store.append({ type: "escalation_stale", source: "monitor:queue", payload: { ref: String(wait.seq), reason: "waiting_unreleased" } });
  w.at(later(T0, 20));
  const rows = ownerTodoFrom(w.input(), w.facts()).filter((r) => r.kind === "waiting_human");
  assert.deepEqual(
    rows.map((r) => r.whyOwner),
    ["재로그인: 어느 세션에서든 /login 한 번 → 멈춘 세션마다 claude --continue (/goal 이 지워졌으면 다시)"],
  );
});
