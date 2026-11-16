import { defineEvent, oneOf, str } from "../define.ts";

// Decision 324: one tool call the orchestrator or a lead made in its own turn, written by PostToolUse.
// A call made inside one of its subagents is not one; a call a gate denied never reaches PostToolUse.
export default defineEvent("tool_called", { session: str, role: oneOf("orchestrator", "lead"), tool: str });
