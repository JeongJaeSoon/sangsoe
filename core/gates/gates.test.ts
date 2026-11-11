import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluate, GATES, hookOutput, mergeVerdicts, parseHookInput, roleOf, START_TOOL_ID } from "./index.ts";
import { blockersOf, REPLAY_CWD, replay } from "./replay.ts";
import type { Facts, OpenPr, Role } from "./types.ts";

// Raw commands live in the fixture, not in this file: the repository scan for raw starts reads code files.
const FIXTURE = readFileSync(new URL("../../test/fixtures/hook-commands.jsonl", import.meta.url), "utf8");
const lines = FIXTURE.split("\n")
  .filter((l) => l.trim() !== "")
  .map(
    (l) =>
      JSON.parse(l) as {
        expect: string;
        gate?: string;
        agent_type?: string;
        tool_name: string;
        tool_input: Record<string, unknown>;
        facts?: { role?: Role; load?: "warn" | "danger"; openPrs?: OpenPr[]; scripts?: Record<string, string>; blockers?: Record<string, string[] | null> };
      },
  );

// The facts a fixture line assumes, as the replay builds them.
const denyFacts = (l: (typeof lines)[number]): Facts => ({
  role: () => l.facts?.role ?? roleOf(l.agent_type, () => undefined),
  load: () => ({ level: l.facts?.load ?? "ok", reasons: [] }),
  ownOpenPrs: () => l.facts?.openPrs,
  readScript: (p) => l.facts?.scripts?.[p],
  doneBlockers: (task) => blockersOf(l.facts ?? {}, task),
});

const calm: Facts = {
  role: () => "general",
  load: () => ({ level: "ok", reasons: [] }),
  ownOpenPrs: () => undefined,
  readScript: () => undefined,
  doneBlockers: () => [],
};

test("fixture of real commands: no false positive, no false negative, the expected gate denies", (t) => {
  const { rows, counts } = replay(FIXTURE);
  t.diagnostic(JSON.stringify(counts));
  assert.deepEqual(
    rows.filter((r) => !r.ok).map((r) => `line ${r.n} (${r.note}): expected ${r.expect}, got ${r.got} ${r.gates.join(",")}`),
    [],
  );
  assert.equal(counts.falsePositive + counts.falseNegative + counts.wrongGate, 0);
  assert.ok(counts.deny >= 20 && counts.pass >= 30, "the collection covers both sides");
});

test("each gate carries its own fixture lines: without it they pass", () => {
  for (const gate of GATES) {
    const others = GATES.filter((g) => g !== gate);
    const mine = lines.filter((l) => {
      const call = { tool: l.tool_name, input: l.tool_input, cwd: REPLAY_CWD, subagent: false };
      return l.expect === "deny" && evaluate(call, denyFacts(l), [gate]).decision === "deny";
    });
    assert.ok(mine.length >= 2, `${gate.name} denies at least two fixture lines`);
    for (const l of mine) {
      const call = { tool: l.tool_name, input: l.tool_input, cwd: REPLAY_CWD, subagent: false };
      assert.notEqual(evaluate(call, denyFacts(l), others).decision, "deny", `${gate.name}: ${JSON.stringify(l.tool_input)}`);
    }
  }
});

test("raw_start_refused: every raw start form is denied and the message names start_unit and the person's CLI", () => {
  const starts = lines.filter((l) => l.gate === "start");
  assert.ok(starts.length >= 15);
  for (const l of starts) {
    const call = { tool: l.tool_name, input: l.tool_input, cwd: REPLAY_CWD, subagent: false };
    const m = evaluate(call, denyFacts(l));
    assert.equal(m.decision, "deny", JSON.stringify(l.tool_input));
    const reason = m.verdicts.map((v) => v.reason).join("\n");
    assert.match(reason, /^\[gate:start\]/m);
    assert.ok(reason.includes(START_TOOL_ID), reason);
    assert.ok(reason.includes("sangsoe item new"), reason);
  }
});

test("raw_start_refused: the core start path is not blocked", () => {
  // The core calls Orca from the MCP server's own process, which PreToolUse never sees; what the model
  // sends is the start_unit call itself, and that passes for every role at normal load.
  for (const role of ["general", "worker", "lead", "orchestrator"] as const) {
    const call = {
      tool: START_TOOL_ID,
      input: { role, worktreeId: "wt", runId: "run_1", childRole: "worker", spec: "/goal x\nREPORT run:run_1" },
      cwd: REPLAY_CWD,
      subagent: false,
    };
    assert.equal(evaluate(call, { ...calm, role: () => role }).decision, "none", role);
  }
});

test("hook output: deny and ask only; allow and no opinion write nothing", () => {
  const v = (decision: "allow" | "ask" | "deny") => ({ decision, gate: "start" as const, reason: decision });
  assert.equal(hookOutput(mergeVerdicts([])), "");
  assert.equal(hookOutput(mergeVerdicts([v("allow")])), "");
  const ask = JSON.parse(hookOutput(mergeVerdicts([v("allow"), v("ask")])));
  assert.equal(ask.hookSpecificOutput.permissionDecision, "ask");
  const deny = JSON.parse(hookOutput(mergeVerdicts([v("deny"), v("ask"), v("deny")])));
  assert.deepEqual(deny.hookSpecificOutput, {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "deny\ndeny",
  });
});

test("hook input that cannot be read is refused, not passed", () => {
  assert.equal(parseHookInput("not json").ok, false);
  assert.equal(parseHookInput("{}").ok, false);
  assert.equal(parseHookInput(JSON.stringify({ tool_name: "Bash" })).ok, false);
  const ok = parseHookInput(JSON.stringify({ tool_name: "Edit", tool_input: {}, cwd: "/w", agent_id: "a1" }));
  assert.ok(ok.ok && ok.call.subagent);
});

test("role: a declared sangsoe agent, else Orca's Dispatch preamble makes a worker, else general", () => {
  assert.equal(roleOf("sangsoe:orchestrator", () => undefined), "orchestrator");
  assert.equal(roleOf("other:lead", () => undefined), "general");
  const preamble = "You are working inside Orca, a multi-agent IDE.\nYou are a dispatched worker.";
  assert.equal(roleOf(undefined, () => preamble), "worker");
  assert.equal(roleOf(undefined, () => "fix the login page"), "general");
});

test("load, open PRs and scripts are read only when a gate needs them", () => {
  // role is left out: the delegate gate asks it for any call outside coordination, and it costs one
  // read of the transcript's head at most.
  let reads = 0;
  const read = <T>(v: T) => {
    reads++;
    return v;
  };
  const counting: Facts = {
    role: () => "general",
    load: () => read({ level: "ok", reasons: [] }),
    ownOpenPrs: () => read(undefined),
    readScript: () => read(undefined),
    doneBlockers: () => read(undefined),
  };
  for (const command of ["ls -la", "git status", "npm test", "sed -n '1,5p' a.ts | head"]) {
    evaluate({ tool: "Bash", input: { command }, cwd: REPLAY_CWD, subagent: false }, counting);
  }
  evaluate({ tool: "Read", input: { file_path: "/w/a.md" }, cwd: REPLAY_CWD, subagent: false }, counting);
  assert.equal(reads, 0);
});
