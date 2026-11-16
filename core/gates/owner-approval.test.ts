import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "./index.ts";
import type { Facts, Role } from "./types.ts";

// Decision 311: no session puts the owner's approval line into a prompt, and none feeds the prompt hook by hand.

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const LINE = `승인 acme/api#12 ${HEAD}`;
const facts = (role: Role): Facts => ({
  role: () => role,
  load: () => ({ level: "ok", reasons: [] }),
  ownOpenPrs: () => undefined,
  readScript: () => undefined,
  doneBlockers: () => [],
  sangsoe: () => undefined,
});
const call = (role: Role, tool: string, input: Record<string, unknown>) => {
  const m = evaluate({ tool, input, cwd: "/work/acme", subagent: false }, facts(role));
  return { decision: m.decision, gate: m.verdicts.find((v) => v.gate === "owner-approval") };
};

test("311: every role is refused a prompt-scheduling tool or a terminal send that carries the approval line", () => {
  for (const role of ["orchestrator", "lead", "worker", "general"] as const) {
    for (const [tool, input] of [
      ["ScheduleWakeup", { delaySeconds: 60, reason: "x", prompt: LINE }],
      ["CronCreate", { cron: "*/5 * * * *", prompt: `check then ${LINE.toUpperCase()}` }],
      ["Bash", { command: `orca terminal send --terminal term_ab12 --text "${LINE}" --enter` }],
      ["Bash", { command: `orca terminal send --terminal term_ab12 --text='${LINE}'` }],
    ] as const) {
      const r = call(role, tool, input);
      assert.equal(r.gate?.decision, "deny", `${role} ${tool} ${JSON.stringify(input)}`);
      assert.match(r.gate?.reason ?? "", /^\[gate:owner-approval\]/);
      assert.match(r.gate?.reason ?? "", /owner types/);
    }
  }
});

test("311: feeding the prompt hook by hand is refused in any form the parser reads", () => {
  for (const command of [
    `echo '{"session_id":"o1","prompt":"x"}' | sangsoe hook user-prompt-submit`,
    `sangsoe hook user-prompt-submit < in.json`,
    `node cli/main.ts hook user-prompt-submit < in.json`,
    `env HOME=/tmp/x sangsoe hook user-prompt-submit`,
  ]) {
    assert.equal(call("worker", "Bash", { command }).gate?.decision, "deny", command);
  }
});

test("311: the same tools without the line, a mention of the hook, and the owner's line in other places pass", () => {
  for (const [tool, input] of [
    ["ScheduleWakeup", { delaySeconds: 60, reason: "x", prompt: "<<autonomous-loop-dynamic>>" }],
    ["ScheduleWakeup", { delaySeconds: 60, reason: "x", prompt: `승인 acme/api#12 ${HEAD.slice(0, 7)}` }],
    ["Bash", { command: `orca terminal send --terminal term_ab12 --text "status?" --enter` }],
    ["Bash", { command: `grep -rn "hook user-prompt-submit" core` }],
    ["Bash", { command: `sangsoe hook session-start < in.json` }],
    ["Bash", { command: `gh pr view 12 --repo acme/api --json headRefOid` }],
  ] as const) {
    assert.equal(call("worker", tool, input).gate, undefined, `${tool} ${JSON.stringify(input)}`);
  }
});
