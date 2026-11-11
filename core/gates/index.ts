import { delegateGate } from "./delegate.ts";
import { doneBlockersGate } from "./done-blockers.ts";
import { type Merged, mergeVerdicts } from "./merge.ts";
import { pressureGate } from "./pressure.ts";
import { reportAddress } from "./report-address.ts";
import { selfLandGate } from "./self-land.ts";
import { sleepLoop } from "./sleep-loop.ts";
import { startGuard } from "./start.ts";
import type { Facts, Gate, Role, ToolCall } from "./types.ts";

export { type Merged, mergeVerdicts } from "./merge.ts";
export { START_TOOL, START_TOOL_ID } from "./start.ts";
export type * from "./types.ts";

export const GATES: readonly Gate[] = [startGuard, reportAddress, sleepLoop, pressureGate, delegateGate, selfLandGate, doneBlockersGate];

/** One PreToolUse event: every gate, merged deny > ask > allow. */
export function evaluate(call: ToolCall, facts: Facts, gates: readonly Gate[] = GATES): Merged {
  return mergeVerdicts(gates.map((g) => g(call, facts)).filter((v) => v !== null));
}

export type HookInput = {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
  session_id?: string;
  transcript_path?: string;
  agent_id?: string;
  agent_type?: string;
};

/** Reads Claude Code's PreToolUse input. Anything else is a refusal: the hook fails closed. */
export function parseHookInput(text: string): { ok: true; input: HookInput; call: ToolCall } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "hook input is not JSON" };
  }
  const o = raw as Partial<HookInput> | null;
  if (!o || typeof o !== "object" || typeof o.tool_name !== "string" || typeof o.tool_input !== "object" || !o.tool_input) {
    return { ok: false, reason: "hook input has no tool_name and tool_input" };
  }
  const input: HookInput = { ...o, tool_name: o.tool_name, tool_input: o.tool_input, cwd: typeof o.cwd === "string" ? o.cwd : "" };
  return {
    ok: true,
    input,
    call: { tool: input.tool_name, input: input.tool_input, cwd: input.cwd, subagent: typeof o.agent_id === "string" },
  };
}

const AGENTS: Record<string, Role> = {
  "sangsoe:orchestrator": "orchestrator",
  "sangsoe:lead": "lead",
  "sangsoe:worker": "worker",
};
// The opening Orca writes into every dispatched worker's first prompt.
const PREAMBLE = /You are working inside Orca, a multi-agent IDE\.\s+You are a dispatched worker\b/;

/** A declared agent first; else a session whose first prompt is Orca's Dispatch preamble is a worker. */
export function roleOf(agentType: string | undefined, firstPrompt: () => string | undefined): Role {
  if (agentType && AGENTS[agentType]) return AGENTS[agentType];
  return PREAMBLE.test(firstPrompt() ?? "") ? "worker" : "general";
}

/**
 * Claude Code's PreToolUse output. Only deny and ask are ever written: an allow from a hook would
 * approve the call past the person's own permission rules, which no gate here means to do.
 */
export function hookOutput(m: Merged): string {
  if (m.decision !== "deny" && m.decision !== "ask") return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: m.decision,
      permissionDecisionReason: m.verdicts.map((v) => v.reason).join("\n"),
    },
  });
}
