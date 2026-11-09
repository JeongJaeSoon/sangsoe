import { dedupeKey, EVENTS, type StoredEvent } from "../contract/index.ts";
import type { Store } from "../store/store.ts";
import { hashOf, mask, summarize } from "./mask.ts";
import type { SessionRow } from "./session.ts";
import { type ShellInput, shellInputs, tail } from "./transcript.ts";

const SOURCE = "owner_input";

/** Decision 91⑥(2)'s default watch_commands: a `!` line starting with one of these that links nowhere is unlinked. */
export const WATCH_COMMANDS = ["gh workflow run", "gh pr merge", "gh release", "sangsoe plugin approve"] as const;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const URL = /https?:\/\/[^\s<>"']+/;

interface OpenHint {
  readonly task: string;
  readonly hint: string;
  readonly since: string;
}

/** Owner items with a cmd_hint and no transition to done or cancelled: the only targets a `!` line may mark. */
function openHints(events: readonly StoredEvent[]): OpenHint[] {
  const closed = new Set(
    events.filter((e) => e.type === "item_transition" && (e.payload.to === "done" || e.payload.to === "cancelled")).map((e) => String(e.payload.task)),
  );
  const latest = new Map<string, OpenHint>();
  for (const e of events) {
    if (e.type !== "item_extra_set" || typeof e.payload.cmd_hint !== "string") continue;
    const task = String(e.payload.task);
    latest.set(task, { task, hint: e.payload.cmd_hint, since: latest.get(task)?.since ?? e.ts });
  }
  return [...latest.values()].filter((h) => !closed.has(h.task));
}

/** Every word of the hint appears in the command, in any order (core arguments included). */
const matches = (command: string, hint: string) => {
  const have = new Set(words(command));
  const want = words(hint);
  return want.length > 0 && want.every((w) => have.has(w));
};

/**
 * Reads the owner's `!` commands from the transcript (decision 91⑥(1)(b), 92 (나)) and records each once
 * by its record uuid. A command marks at most one open owner item, and only as a hint: `owner_act:failed`
 * when stderr is not empty, `owner_act:seen` when stdout carries a URL (the transcript holds no exit
 * code, P13), nothing otherwise. A watched command that marks nothing is `owner_act_unlinked`.
 */
export function recordShellInputs(store: Store, row: SessionRow, session: string, transcriptPath: string | undefined): number {
  const inputs = shellInputs(tail(transcriptPath));
  if (inputs.length === 0) return 0;
  const events = store.events();
  const seen = new Set(events.filter((e) => e.type === "owner_action").map((e) => e.dedupe_key));
  const hints = openHints(events);
  let n = 0;
  for (const s of inputs) {
    const key = dedupeKey(EVENTS.owner_action, session, s.uuid);
    if (seen.has(key)) continue;
    record(store, row, session, key, s, hints);
    n++;
  }
  return n;
}

function record(store: Store, row: SessionRow, session: string, key: string, s: ShellInput, hints: readonly OpenHint[]): void {
  const masked = mask(s.command);
  const action = store.appendOwnerAction(
    {
      type: "owner_action",
      source: SOURCE,
      ...(row.task ? { entity: "task", entity_id: row.task } : {}),
      dedupe_key: key,
      payload: { origin: "shell", summary: summarize(masked), hash: hashOf(masked), cc_session: session, cc_message: s.uuid },
    },
    masked,
  );
  if (!action.inserted) return;
  // An input before the item was made is not linked (decision 91 (4)(가)).
  const hits = hints.filter((h) => matches(s.command, h.hint) && (s.ts === undefined || s.ts >= h.since));
  const only = hits.length === 1 ? hits[0] : undefined;
  if (only) {
    const url = URL.exec(s.stdout)?.[0];
    const failed = s.stderr !== "";
    if (!failed && !url) return;
    store.append({
      type: "evidence",
      source: SOURCE,
      entity: "task",
      entity_id: only.task,
      subject: `owner_action:${action.seq}`,
      dedupe_key: dedupeKey(EVENTS.evidence, s.uuid, "owner_act"),
      payload: failed
        ? { kind: "owner_act:failed", observed: summarize(mask(s.stderr.split("\n", 1)[0] ?? "")) }
        : { kind: "owner_act:seen", observed: mask(url ?? "") },
    });
    return;
  }
  if (hits.length === 0 && WATCH_COMMANDS.some((w) => s.command.trim().startsWith(w))) {
    store.append({
      type: "owner_act_unlinked",
      source: SOURCE,
      subject: `owner_action:${action.seq}`,
      dedupe_key: dedupeKey(EVENTS.owner_act_unlinked, s.uuid),
      payload: { act: summarize(masked) },
    });
  }
}
