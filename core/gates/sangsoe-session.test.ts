import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { scratchDir } from "../../test/scratch.ts";
import { realHost } from "../install/host.ts";
import { hostFacts } from "./facts.ts";
import { evaluate, parseHookInput } from "./index.ts";
import type { Facts } from "./types.ts";

// Decision 239: the start guard refuses a raw start only in a session that is sangsoe's — a sangsoe
// agent, a session sangsoe recorded as started, or a worker on a Task sangsoe made. Other programs'
// sessions on the same machine start their own workers their own way.

type Row = { type: string; entity_id?: string; payload: Record<string, unknown> };
const storeOf = (rows: Row[]) => () => ({ events: (f?: { type?: string }) => rows.filter((r) => !f?.type || r.type === f.type) as never });
const transcript = (firstPrompt: string) => {
  const path = join(scratchDir("sangsoe-gate-239-"), "t.jsonl");
  writeFileSync(path, `${JSON.stringify({ type: "user", message: { content: firstPrompt } })}\n`);
  return path;
};
const preamble = (task: string) =>
  `You are working inside Orca, a multi-agent IDE. You are a dispatched worker.\nYour coordinator's terminal handle is: term_x\nYour task ID is: ${task}\n`;
const input = (extra: Record<string, unknown>) => ({ tool_name: "Bash", tool_input: { command: "true" }, cwd: "/work/acme", session_id: "s1", ...extra });
const facts = (extra: Record<string, unknown>, rows: Row[] | undefined) =>
  hostFacts(input(extra), realHost, rows === undefined ? () => undefined : storeOf(rows));

test("239: a sangsoe agent, a session sangsoe started, or a worker on a Task sangsoe made is sangsoe's", () => {
  assert.equal(facts({ agent_type: "sangsoe:lead" }, []).sangsoe(), true);
  assert.equal(facts({}, [{ type: "session_started", payload: { session: "s1", role: "lead" } }]).sangsoe(), true);
  const made: Row[] = [{ type: "item_created", entity_id: "task_made", payload: {} }];
  assert.equal(facts({ transcript_path: transcript(preamble("task_made")) }, made).sangsoe(), true);
});

test("239: another program's worker, or a session sangsoe never saw, is not sangsoe's", () => {
  const made: Row[] = [{ type: "item_created", entity_id: "task_made", payload: {} }];
  assert.equal(facts({ transcript_path: transcript(preamble("task_other")) }, made).sangsoe(), false);
  assert.equal(facts({ agent_type: "other-plugin:lead" }, made).sangsoe(), false);
  assert.equal(facts({ transcript_path: transcript("fix the login bug") }, made).sangsoe(), false);
  assert.equal(facts({}, [{ type: "session_started", payload: { session: "someone-else", role: "lead" } }]).sangsoe(), false);
});

test("239: an unreadable store is not known, so the guard keeps refusing", () => {
  assert.equal(facts({ transcript_path: transcript(preamble("task_other")) }, undefined).sangsoe(), undefined);
  const throwing = hostFacts(input({}), realHost, () => {
    throw new Error("database is locked");
  });
  assert.equal(throwing.sangsoe(), undefined);
});

const start = (command: string, sangsoe: boolean | undefined) => {
  const parsed = parseHookInput(JSON.stringify(input({ tool_input: { command } })));
  assert.ok(parsed.ok);
  const f: Facts = {
    role: () => "worker",
    load: () => ({ level: "ok", reasons: [] }),
    ownOpenPrs: () => [],
    readScript: () => undefined,
    doneBlockers: () => [],
    sangsoe: () => sangsoe,
  };
  return evaluate(parsed.call, f).verdicts.filter((v) => v.gate === "start").map((v) => v.decision);
};

test("239: a raw start is refused in a sangsoe session and when that is unknown, and left alone in another program's", () => {
  const raw = "orca orchestration worker-start --task task_1 --worktree new-child --agent claude";
  assert.deepEqual(start(raw, true), ["deny"], "a sangsoe session still goes through start_unit");
  assert.deepEqual(start(raw, undefined), ["deny"], "not knowing fails safe");
  assert.deepEqual(start(raw, false), [], "another program's lead starts its own workers");
});
