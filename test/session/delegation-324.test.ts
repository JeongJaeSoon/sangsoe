// Decision 324: the orchestrator's and a lead's own tool calls are counted, so the share they hand to a
// subagent (Agent) can be read. A subagent's calls (the hook input carries agent_id) and a worker's are
// not counted. The brief shows today's share in one line.
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type BriefSnapshot, buildBrief, recordHook, renderMarkdown, replayJsonl, type SessionHook, type SessionHookInput } from "../../core/index.ts";
import { createSessionWorld, type SessionWorld, TASK_RUN } from "./world.ts";

const hook = (w: SessionWorld, event: SessionHook, input: Partial<SessionHookInput> & { session_id: string }) =>
  recordHook(event, w, { cwd: w.dir, ...input });
const counted = (w: SessionWorld) => w.store.events({ type: "tool_called" }).map((e) => e.payload);

test("PostToolUse counts the orchestrator's own calls once each and leaves its subagents' calls out", async () => {
  const w = createSessionWorld({ dispatched: false, heldRun: "run_orch" });
  await hook(w, "session-start", { session_id: "o1", source: "startup", agent_type: "sangsoe:orchestrator" });
  await hook(w, "post-tool-use", { session_id: "o1", tool_name: "Bash", tool_use_id: "toolu_1" });
  await hook(w, "post-tool-use", { session_id: "o1", tool_name: "Agent", tool_use_id: "toolu_2" });
  await hook(w, "post-tool-use", { session_id: "o1", tool_name: "Agent", tool_use_id: "toolu_2" });
  await hook(w, "post-tool-use", { session_id: "o1", tool_name: "Read", tool_use_id: "toolu_3", agent_id: "a1", agent_type: "sangsoe:secretary" });
  assert.deepEqual(counted(w), [
    { session: "o1", role: "orchestrator", tool: "Bash" },
    { session: "o1", role: "orchestrator", tool: "Agent" },
  ]);
});

test("a lead's calls are counted with its role; a worker's are not", async () => {
  const lead = createSessionWorld({ spec: "sangsoe-role: lead\nrun the program", heldRun: TASK_RUN });
  await hook(lead, "session-start", { session_id: "l1", source: "startup" });
  await hook(lead, "post-tool-use", { session_id: "l1", tool_name: "Task", tool_use_id: "toolu_9" });
  assert.deepEqual(counted(lead), [{ session: "l1", role: "lead", tool: "Task" }]);

  const worker = createSessionWorld();
  await hook(worker, "session-start", { session_id: "w1", source: "startup" });
  await hook(worker, "post-tool-use", { session_id: "w1", tool_name: "Agent", tool_use_id: "toolu_8" });
  assert.deepEqual(counted(worker), []);
});

const FIX = new URL("../fixtures/brief/", import.meta.url);
const NOW = "2026-11-10T12:00:00.000Z";
const base = readFileSync(new URL("sample.events.jsonl", FIX), "utf8");
const orca = JSON.parse(readFileSync(new URL("sample.orca.json", FIX), "utf8")) as BriefSnapshot;
const call = (ts: string, role: string, tool: string, n: number) =>
  JSON.stringify({ ts, type: "tool_called", source: "PostToolUse", dedupe_key: `tool_called:s-${role}:t${n}`, payload: { session: `s-${role}`, role, tool } });
const withCalls = (...lines: string[]) => buildBrief({ events: replayJsonl(`${base}\n${lines.join("\n")}\n`), orca, now: NOW });

test("the brief adds today's delegation share per role only when there were calls", () => {
  assert.equal(withCalls().delegationToday, undefined);
  const o = withCalls(
    call("2026-11-10T09:00:00.000Z", "orchestrator", "Agent", 1),
    call("2026-11-10T09:01:00.000Z", "orchestrator", "Bash", 2),
    call("2026-11-10T09:02:00.000Z", "orchestrator", "Read", 3),
    call("2026-11-10T09:03:00.000Z", "orchestrator", "Task", 4),
    call("2026-11-10T09:04:00.000Z", "lead", "Bash", 5),
    // Yesterday's call is not today's.
    call("2026-11-09T09:00:00.000Z", "lead", "Agent", 6),
  );
  assert.equal(o.delegationToday, "오늘 위임(서브에이전트 호출/직접 호출): 오케스트레이터 2/4 (50%) · 리드 0/1 (0%)");
  assert.ok(renderMarkdown(o).includes(`\n${o.delegationToday}\n`) || renderMarkdown(o).trimEnd().endsWith(o.delegationToday ?? "-"));
});
