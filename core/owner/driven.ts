import type { StoredEvent } from "../contract/index.ts";
import { hashOf, mask } from "../session/mask.ts";
import type { Store } from "../store/store.ts";

/**
 * How long a driven prompt may wait in a busy session's queue before its UserPromptSubmit fires and
 * still be matched. Past it the prompt is read by its shape alone, as before decision 280.
 */
export const DRIVEN_WINDOW_MS = 60 * 60_000;

const hashOfPrompt = (prompt: string) => hashOf(mask(prompt.trim()));

/**
 * Decision 280: one row per prompt Orca's `agent.prompt.before` hook reports. Orca calls that hook for
 * input driven into an agent's terminal, not for what a person types there, so the row says "this
 * terminal was handed this text by a program". Called from the plugin worker; the text is not stored.
 */
export function recordDriven(store: Store, e: { terminal: string; prompt: string; inputKind?: string | undefined; agent?: string | undefined }): void {
  if (e.terminal === "" || e.prompt.trim() === "") return;
  store.append({
    type: "prompt_driven",
    source: "orca-plugin:hook",
    payload: { terminal: e.terminal, hash: hashOfPrompt(e.prompt), ...(e.inputKind ? { input_kind: e.inputKind } : {}), ...(e.agent ? { agent: e.agent } : {}) },
  });
}

/** Whether Orca reported this text as driven into this terminal within the window before `now`. */
export function wasDriven(events: readonly StoredEvent[], terminal: string | undefined, prompt: string, now: number): boolean {
  if (!terminal) return false;
  const hash = hashOfPrompt(prompt);
  return events.some((e) => e.type === "prompt_driven" && e.payload.terminal === terminal && e.payload.hash === hash && now - Date.parse(e.ts) <= DRIVEN_WINDOW_MS);
}
