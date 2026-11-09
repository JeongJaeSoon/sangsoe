import type { StoredEvent, ViewInput } from "../contract/index.ts";
import { dedupeKey, EVENTS } from "../contract/index.ts";
import { LOCAL_HOST } from "../orca/host-filter.ts";
import type { Appended, Store } from "../store/store.ts";
import { OWNER_DEFAULTS, type OwnerConfig } from "./types.ts";

/**
 * What a detector saw on a session with an open waiting_human (decision 91①). `hostId` is where the
 * session runs; a row from another host is neither released nor closed as moot (92 (라), 88).
 * The owner's own prompt is not a signal: it only marks the wait `입력 확인됨 · 재개 대기`.
 */
export type ReleaseSignal =
  | { readonly kind: "button"; readonly session: string; readonly waiting: number; readonly hostId?: string }
  | { readonly kind: "turn_ended"; readonly session: string; readonly hostId?: string }
  | { readonly kind: "tool"; readonly session: string; readonly tool: string; readonly hostId?: string }
  | { readonly kind: "agent_wait_gone"; readonly session: string; readonly hostId: string }
  | { readonly kind: "session_ended"; readonly session: string; readonly evidence: "session_ended" | "worker_dead"; readonly hostId?: string };

export interface Release {
  readonly ref: number;
  readonly outcome: "answered" | "moot";
  readonly by: "owner" | "button" | "unknown";
  readonly evidence: string;
}

/** The only event types releasesFor reads, so a caller on every tool call can load just these. */
export const RELEASE_READS = ["waiting_human", "waiting_released", "owner_action"] as const;

/** waiting_human rows with no waiting_released yet. */
export function openWaits(events: readonly StoredEvent[]): StoredEvent[] {
  const released = new Set(events.filter((e) => e.type === "waiting_released").map((e) => String(e.payload.ref)));
  return events.filter((e) => e.type === "waiting_human" && !released.has(String(e.seq)));
}

const ownerSpokeAfter = (events: readonly StoredEvent[], w: StoredEvent) =>
  events.some((e) => e.type === "owner_action" && e.seq > w.seq && e.payload.cc_session === w.payload.session);

/** Open waits the owner has answered in chat while the session has not moved yet: `입력 확인됨 · 재개 대기`. */
export function awaitingResume(input: ViewInput): number[] {
  return openWaits(input.events)
    .filter((w) => ownerSpokeAfter(input.events, w))
    .map((w) => w.seq);
}

/**
 * The waiting_released rows one signal earns. A tool signal releases only a wait whose notice named
 * that tool (a parallel tool must not release another's wait); a wait with no tool name is not
 * released by tools. `by` is owner when the owner spoke on that session after the wait.
 */
export function releasesFor(input: Pick<ViewInput, "events">, signal: ReleaseSignal): Release[] {
  if (signal.hostId !== undefined && signal.hostId !== LOCAL_HOST) return [];
  const waits = openWaits(input.events).filter((w) => w.payload.session === signal.session);
  const by = (w: StoredEvent): Release["by"] => (signal.kind === "button" ? "button" : ownerSpokeAfter(input.events, w) ? "owner" : "unknown");
  switch (signal.kind) {
    case "button":
      return waits.filter((w) => w.seq === signal.waiting).map((w) => ({ ref: w.seq, outcome: "answered", by: by(w), evidence: "panel_button" }));
    case "turn_ended":
      return waits.map((w) => ({ ref: w.seq, outcome: "answered", by: by(w), evidence: "turn_ended" }));
    case "tool":
      return waits.filter((w) => typeof w.payload.tool === "string" && w.payload.tool === signal.tool).map((w) => ({ ref: w.seq, outcome: "answered", by: by(w), evidence: `tool:${signal.tool}` }));
    case "agent_wait_gone":
      return waits.map((w) => ({ ref: w.seq, outcome: "answered", by: by(w), evidence: "agent_wait_gone" }));
    case "session_ended":
      return waits.map((w) => ({ ref: w.seq, outcome: "moot", by: "unknown", evidence: signal.evidence }));
  }
}

/**
 * Writes each release once: the first signal that saw it wins (dedupe waiting_released:<seq>). The
 * row carries the wait's entity, so it stays on the item's timeline.
 */
export function recordReleases(store: Pick<Store, "append">, input: Pick<ViewInput, "events">, signal: ReleaseSignal, source = "hook:release"): Appended[] {
  const waits = new Map(input.events.map((e) => [e.seq, e]));
  return releasesFor(input, signal).map((r) => {
    const w = waits.get(r.ref);
    return store.append({
      type: "waiting_released",
      source,
      payload: { ref: String(r.ref), outcome: r.outcome, by: r.by, evidence: r.evidence },
      ...(w?.entity ? { entity: w.entity } : {}),
      ...(w?.entity_id ? { entity_id: w.entity_id } : {}),
      dedupe_key: dedupeKey(EVENTS.waiting_released, String(r.ref)),
    });
  });
}

/**
 * Waits the owning lead has not released within waiting.lead_minutes and that are not escalated
 * yet: the queue-monitor writes escalation_stale{waiting_unreleased} for each, and only then does
 * the wait reach owner_todo. Non-local waits are left alone.
 */
export function unreleasedWaits(input: ViewInput, isLocal: (session: string) => boolean, cfg: Pick<OwnerConfig, "leadMinutes"> = OWNER_DEFAULTS): StoredEvent[] {
  const escalated = new Set(input.events.filter((e) => e.type === "escalation_stale" && e.payload.reason === "waiting_unreleased").map((e) => String(e.payload.ref)));
  const limit = Date.parse(input.now) - cfg.leadMinutes * 60_000;
  return openWaits(input.events).filter((w) => Date.parse(w.ts) <= limit && !escalated.has(String(w.seq)) && isLocal(String(w.payload.session)));
}

/** One escalation_stale{waiting_unreleased} per wait, carrying the masked screen excerpt the monitor read. */
export function recordUnreleased(store: Pick<Store, "append">, wait: StoredEvent, excerpt?: string, source = "monitor:queue"): Appended {
  return store.append({
    type: "escalation_stale",
    source,
    payload: { ref: String(wait.seq), reason: "waiting_unreleased", ...(excerpt ? { excerpt: excerpt.slice(0, 2000) } : {}) },
    ...(wait.entity ? { entity: wait.entity } : {}),
    ...(wait.entity_id ? { entity_id: wait.entity_id } : {}),
    dedupe_key: dedupeKey(EVENTS.escalation_stale, String(wait.seq), "waiting_unreleased"),
  });
}
