import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "./index.ts";
import type { Facts } from "./types.ts";

// Decision 300: the four calls an orchestrator's own turn made and the gate refused (shapes rebuilt, not copied).
const orchestrator: Facts = {
  role: () => "orchestrator",
  load: () => ({ level: "ok", reasons: [] }),
  ownOpenPrs: () => undefined,
  readScript: () => undefined,
  doneBlockers: () => [],
  sangsoe: () => undefined,
};
const run = (tool: string, input: Record<string, unknown>) =>
  evaluate({ tool, input, cwd: "/work/acme", subagent: false }, orchestrator);
const bash = (command: string) => run("Bash", { command });
const why = (m: ReturnType<typeof run>) => m.verdicts.map((v) => v.reason).join("\n");
const OUT = "/private/tmp/claude-501/-work-acme/0a1b2c3d-0000-4000-8000-000000000000/tasks/b1x2y3z4.output";

test("300 (a): the orchestrator reads the output file of its own background wait", () => {
  assert.equal(run("Read", { file_path: OUT }).decision, "none");
  assert.equal(run("Read", { file_path: OUT.replace("/private", "") }).decision, "none");
  assert.equal(bash(`cat ${OUT}`).decision, "none");
});

test("300 (a): only a task output file under the harness tmp is opened", () => {
  for (const f of [
    "/private/tmp/claude-501/p/s/tasks/../../../secret.output",
    "/private/tmp/claude-501/p/s/tasks/x.sh",
    "/private/tmp/other/p/s/tasks/x.output",
    "/work/acme/tasks/x.output",
    "/private/tmp/claude-501/p/s/notes/x.output",
  ]) {
    assert.equal(run("Read", { file_path: f }).decision, "deny", f);
  }
  assert.equal(bash(`cat ${OUT} /work/acme/a.ts`).decision, "deny");
});

test("300 (b): orca terminal close stays refused and the refusal names worker-release, unit_close and worker-stop", () => {
  const v = bash("orca terminal close --terminal term_abc");
  assert.equal(v.decision, "deny");
  assert.match(why(v), /unit_close/);
  assert.match(why(v), /worker-stop/);
  assert.match(why(v), /worker-release/);
});

test("300 (c): an interpreter in a pipe stays refused and the refusal names jq and the brief resource", () => {
  const v = bash(`orca status --json 2>&1 | python3 -c "import sys"; sangsoe brief 2>&1 | sed -n 1,4p`);
  assert.equal(v.decision, "deny");
  assert.match(why(v), /`jq`/);
  assert.match(why(v), /resource `brief`/);
  assert.match(why(v), /head/);
  // The same wait read through jq is coordination.
  assert.equal(bash("orca status --json 2>&1 | jq '.messages'").decision, "none");
  for (const c of ["sangsoe brief", "sangsoe todo", "sed -n 1,4p a.txt"]) assert.equal(bash(c).decision, "deny", c);
  assert.doesNotMatch(why(bash("sangsoe item set i1 --hold")), /resource `brief`/);
});

test("330: the orchestrator's own turn runs sangsoe restart; other sangsoe writes stay refused", () => {
  for (const c of ["sangsoe restart --stale --dry-run", "sangsoe restart --stale", "sangsoe restart --task task_a"]) assert.equal(bash(c).decision, "none", c);
  for (const c of ["sangsoe item set i1 --hold", "sangsoe restart now please"]) assert.equal(bash(c).decision, "deny", c);
});

test("300 (d): typing into another terminal stays refused and the refusal names reply and send", () => {
  const v = bash('orca terminal send --terminal term_abc --text "4"');
  assert.equal(v.decision, "deny");
  assert.match(why(v), /orchestration reply/);
  assert.match(why(v), /orchestration send/);
});

test("300: a refusal with no named shape keeps only the general way on", () => {
  const v = bash("npm test");
  assert.equal(v.decision, "deny");
  assert.doesNotMatch(why(v), /unit_close|`jq`|orchestration reply/);
});

test("305: the orchestrator lists and reads resources of any server", () => {
  for (const server of ["plugin:other:x", "claude.ai Some", "plugin:sangsoe:sangsoe"]) {
    assert.equal(run("ListMcpResourcesTool", { server }).decision, "none", `${server}: list`);
    assert.equal(run("ReadMcpResourceTool", { server, uri: "other://doc" }).decision, "none", `${server}: read`);
  }
  assert.equal(run("ListMcpResourcesTool", {}).decision, "none");
});

test("305: calling another server's tool stays refused", () => {
  for (const tool of ["mcp__other__write_doc", "mcp__claude_ai_Some__search", "mcp__plugin_other_x__update"]) {
    assert.equal(run(tool, {}).decision, "deny", tool);
  }
});
