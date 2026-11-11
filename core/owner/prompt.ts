/**
 * Prompts no person typed (decision 173's shape rule, widened by decisions 196 and 206): Orca's brief,
 * Orca's new-mail nudge and its mail-delivery turn, another session's message and a background task's
 * notice, which Claude Code also hands to UserPromptSubmit. Orca's own prompt hooks do not see these
 * lines (decision 206), so the shape at the start of the prompt is the only sign.
 */
const ORCA_NUDGE = [
  /^Please carry out this task from my Orca coordinator/,
  /^You are working inside Orca, a multi-agent IDE\./,
  /^You have (\d+|new) orchestration messages?\b/,
  /^Another Claude session sent a message:/,
  /^<task-notification>/,
];

export type PromptOrigin = "owner" | "orca_nudge" | "empty";

/** `orca_nudge` is never an owner_action, so it neither answers a decision nor releases a wait as the owner. */
export function classifyPrompt(text: string): PromptOrigin {
  const start = text.trimStart();
  if (start === "") return "empty";
  return ORCA_NUDGE.some((re) => re.test(start)) ? "orca_nudge" : "owner";
}
