/**
 * Prompts no person typed (decision 173's shape rule, widened by decisions 196 and 206): Orca's brief,
 * Orca's new-mail nudge and its mail-delivery turn, another session's message and a background task's
 * notice, which Claude Code also hands to UserPromptSubmit. Orca's own prompt hooks do not see these
 * lines (decision 206), so the shape at the start of the prompt is the only sign.
 */
const ORCA_NUDGE = [
  /^Please carry out this task from my Orca coordinator/,
  /^You are working inside Orca, a multi-agent IDE\./,
  // "You have 2 orchestration messages", "You have new …", and the held-delivery "You have 2 new …".
  /^You have (?:\d+ )?(?:new )?orchestration messages?\b/,
  /^Another Claude session sent a message:/,
  // A subagent's hand-back: the hook gets the tag without the line above (seen on Claude Code 2.1.325, decision 282).
  /^<agent-message[\s>]/,
  /^<task-notification>/,
];

const PASTED = /^<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">$/;

/**
 * Claude Code hands a long text put into its prompt as one block, `<pasted_content id="…">` around
 * the text and the same id on the closing tag. A prompt that is nothing but one such block is read
 * as the text inside; text around a block, or two blocks, is left as it is (decision 282).
 */
export function unwrapPaste(text: string): string {
  const t = text.trim();
  const m = PASTED.exec(t);
  return m ? (m[2] as string).trim() : t;
}

export type PromptOrigin = "owner" | "orca_nudge" | "empty";

/** `orca_nudge` is never an owner_action, so it neither answers a decision nor releases a wait as the owner. */
export function classifyPrompt(text: string): PromptOrigin {
  const start = unwrapPaste(text);
  if (start === "") return "empty";
  return ORCA_NUDGE.some((re) => re.test(start)) ? "orca_nudge" : "owner";
}
