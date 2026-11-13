import { dedupeKey, eventDef, type StoredEvent } from "../contract/index.ts";
import type { Exec } from "../contract/orca.ts";
import type { Result } from "../notify/result.ts";
import { type Appended, type EventFilter, type NewEvent, Store } from "../store/store.ts";
import { DOCKER_KINDS, type DockerKind, type DockerRef, isDockerKind } from "./docker.ts";

export type ResourceInput = { kind: string; ref: string; owner: string; action?: "created" | "released" };
export type ResourceRecorded = { kind: string; ref: string; owner: string; action: string; seq: number; inserted: boolean };

type Appender = { append(e: NewEvent<"resource"> | NewEvent<"reap_blocked">): Appended; events(f?: EventFilter): StoredEvent[] };

const refusal = (reason: string, fix: string, code = "invalid_input") => ({ ok: false, refusal: { code, reason, fix } }) as const;

/** Who holds one recorded Docker name now. `gen` counts how often it was let go, so a re-made name gets new keys. */
export type Hold = {
  kind: DockerKind;
  ref: string;
  owner: string;
  held: boolean;
  /** Two owners claimed the name: no one holds it again, so REAPER never sweeps it. */
  contested: boolean;
  gen: number;
  createdSeq: number;
};

/**
 * Folds the record of every Docker name in seq order. A hold ends when its owner releases it, when
 * REAPER removes it or finds it gone, or when REAPER hands it to a person as in use: after that the
 * name is no one's until someone records it again, so REAPER never retries an id it could not prove
 * is still the recorded one.
 */
export function dockerHolds(events: readonly StoredEvent[]): Map<string, Hold> {
  const holds = new Map<string, Hold>();
  const rows = [...events].sort((a, b) => a.seq - b.seq);
  for (const e of rows) {
    const p = e.payload as { action?: string; kind: string; ref: string; owner?: string; reason?: string };
    if (!isDockerKind(p.kind)) continue;
    const k = `${p.kind}\n${p.ref}`;
    const h = holds.get(k) ?? { kind: p.kind, ref: p.ref, owner: "", held: false, contested: false, gen: 0, createdSeq: 0 };
    holds.set(k, h);
    const inUse = e.type === "reap_blocked" && p.reason === "in_use";
    const ends = (e.type === "resource" && p.action === "released") || e.type === "reap_done" || inUse;
    if (inUse && e.source === "resource_record") h.contested = true;
    if (e.type === "resource" && p.action === "created" && !h.held && !h.contested) {
      Object.assign(h, { owner: p.owner ?? "", held: true, createdSeq: e.seq });
    } else if (ends && h.held) {
      Object.assign(h, { held: false, gen: h.gen + 1 });
    }
  }
  return holds;
}

export const holdEvents = (events: (f?: EventFilter) => StoredEvent[]) => [
  ...events({ type: "resource" }),
  ...events({ type: "reap_done" }),
  ...events({ type: "reap_blocked" }),
];

/** Decision 240: what only its owner clears. Recorded so the owner sees it; REAPER never takes one. */
export const OWNER_KINDS = ["checkout", "registration", "branch", "file", "process"] as const;
export const isOwnerKind = (k: string) => (OWNER_KINDS as readonly string[]).includes(k);

export type OwnerHold = { kind: string; ref: string; owner: string; held: boolean; gen: number; since: string };

/** Folds owner-kind rows per kind, ref and owner: two owners of one branch are two holds, neither contested. */
export function ownerHolds(events: readonly StoredEvent[]): Map<string, OwnerHold> {
  const holds = new Map<string, OwnerHold>();
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const p = e.payload as { action?: string; kind: string; ref: string; owner?: string };
    if (e.type !== "resource" || !isOwnerKind(p.kind)) continue;
    const owner = p.owner ?? "";
    const k = `${p.kind}\n${p.ref}\n${owner}`;
    const h = holds.get(k) ?? { kind: p.kind, ref: p.ref, owner, held: false, gen: 0, since: "" };
    holds.set(k, h);
    if (p.action === "created" && !h.held) Object.assign(h, { held: true, since: e.ts });
    else if (p.action === "released" && h.held) Object.assign(h, { held: false, gen: h.gen + 1 });
  }
  return holds;
}

function recordOwnerKind(store: Appender, input: Required<ResourceInput>): Result<ResourceRecorded> {
  const { kind, ref, owner, action } = input;
  const hold = ownerHolds(store.events({ type: "resource" })).get(`${kind}\n${ref}\n${owner}`);
  if (action === "released" && !hold?.held) return refusal(`${kind} ${ref} is not held by ${owner}`, "only the owner that recorded it releases it");
  const a = store.append({
    type: "resource",
    source: "resource_record",
    payload: { action, kind, owner, ref },
    dedupe_key: resourceKey(kind, `${ref}\n${owner}`, action, hold?.gen ?? 0),
  });
  return { ok: true, value: { kind, ref, owner, action, seq: a.seq, inserted: a.inserted } };
}

const resourceKey = (kind: string, ref: string, action: string, gen: number) => {
  const def = eventDef("resource");
  if (!def) throw new Error("no event type resource");
  return dedupeKey(def, kind, ref, action, `g${gen}`);
};

/**
 * The one way a resource gets an owner (R-12): whoever made it records it right after making it.
 * REAPER sweeps nothing without such a row. `owner` is the card's worktree instance id or the Orca
 * Task the work ran under. A name another owner still holds is refused, never silently merged:
 * otherwise the first owner's sweep would take the second owner's object.
 */
export function recordResource(store: Appender, input: ResourceInput): Result<ResourceRecorded> {
  const { kind, ref, owner } = input;
  const action = input.action ?? "created";
  if (!isDockerKind(kind) && !isOwnerKind(kind)) {
    return refusal(
      `kind ${JSON.stringify(kind)}: REAPER sweeps ${DOCKER_KINDS.join(", ")}; the owner clears ${OWNER_KINDS.join(", ")}`,
      "resource_record {kind: \"container\", ref, owner}",
    );
  }
  for (const [name, v] of [["ref", ref], ["owner", owner]] as const) {
    if (typeof v !== "string" || v.trim() === "") return refusal(`${name} is empty`, `pass the id, name or path as ref and the Task or worktree id as owner`);
  }
  if (action !== "created" && action !== "released") return refusal(`action ${action}`, "action is created or released");
  if (isOwnerKind(kind)) return recordOwnerKind(store, { kind, ref, owner, action });
  const holdOf = () => dockerHolds(holdEvents((f) => store.events(f))).get(`${kind}\n${ref}`);
  const hold = holdOf();
  if (action === "released" && (!hold?.held || hold.owner !== owner)) {
    return refusal(`${kind} ${ref} is not held by ${owner}`, "only the owner that recorded it releases it");
  }
  if (hold?.held && hold.owner !== owner) return contested(store, hold);
  if (hold?.contested) return contestedRefusal(hold);
  const a = store.append({
    type: "resource",
    source: "resource_record",
    payload: { action, kind, owner, ref },
    dedupe_key: resourceKey(kind, ref, action, hold?.gen ?? 0),
  });
  if (!a.inserted && action === "created") {
    // Another writer recorded the same name between the read and the append.
    const now = holdOf();
    if (now?.held && now.owner !== owner) return contested(store, now);
  }
  return { ok: true, value: { kind, ref, owner, action, seq: a.seq, inserted: a.inserted } };
}

/**
 * A second owner claims a name the first still holds: the object is by then shared, so neither
 * owner's sweep may take it. The hold is ended as in use, which hands the name to a person, and the
 * second owner is refused.
 */
function contested(store: Appender, h: Hold): Result<never> {
  store.append({
    type: "reap_blocked",
    source: "resource_record",
    payload: { kind: h.kind, ref: h.ref, reason: "in_use" },
    dedupe_key: blockedKey(h.kind, h.ref, h.gen),
  });
  return contestedRefusal(h);
}

function contestedRefusal(h: Hold): Result<never> {
  return refusal(
    `${h.kind} ${h.ref} is already recorded for another owner; it is now left for a person, not swept`,
    "use a name of your own (another compose project name)",
    "held_by_other",
  );
}

export const blockedKey = (kind: string, ref: string, gen: number) => {
  const def = eventDef("reap_blocked");
  if (!def) throw new Error("no event type reap_blocked");
  return dedupeKey(def, kind, ref, "in_use", `g${gen}`);
};

/** REAPER's own close of a hold: the recorded name no longer exists in Docker. */
export function goneRow(h: Hold): NewEvent<"resource"> {
  return {
    type: "resource",
    source: "reaper",
    payload: { action: "released", kind: h.kind, owner: h.owner, ref: h.ref },
    dedupe_key: resourceKey(h.kind, h.ref, "released", h.gen),
  };
}

/** Opens the store on first use, so an invalid record never touches it. */
export function lazyStore(open: () => Store = () => Store.open()): Appender & { close(): void } {
  let store: Store | null = null;
  const get = () => {
    if (!store) store = open();
    return store;
  };
  return {
    append: (e) => get().append(e),
    events: (f) => get().events(f),
    close: () => store?.close(),
  };
}

export type RecordInput = { owner: string; kind?: string; ref?: string; action?: "created" | "released"; compose?: string };

/**
 * `resource_record` and `sangsoe resource record`: one id, or with `compose` every id that
 * `compose up` made for that project, each its own `resource` row.
 */
export async function resourceRecord(store: Appender, exec: Exec, input: RecordInput): Promise<Result<{ recorded: ResourceRecorded[] }>> {
  const action = input.action ?? "created";
  if (input.compose === undefined) {
    const one = recordResource(store, { kind: input.kind ?? "", ref: input.ref ?? "", owner: input.owner, action });
    return one.ok ? { ok: true, value: { recorded: [one.value] } } : one;
  }
  if (input.kind !== undefined || input.ref !== undefined) return refusal("compose and kind/ref together", "pass either compose or kind and ref");
  const refs = await composeResources(exec, input.compose);
  if (typeof refs === "string") return { ok: false, refusal: { code: "unavailable", reason: refs, fix: "run it right after compose up, with the same -p project" } };
  // Every ref is tried even after a refusal, so each name the project shares with another owner is
  // marked contested; stopping early would leave the later shared names held and sweepable.
  const recorded: ResourceRecorded[] = [];
  let refused: Exclude<Result<ResourceRecorded>, { ok: true }> | null = null;
  for (const r of refs) {
    const one = recordResource(store, { ...r, owner: input.owner, action });
    if (one.ok) recorded.push(one.value);
    else refused ??= one;
  }
  return refused ?? { ok: true, value: { recorded } };
}

/**
 * The ids `compose up` just made for `project`: its containers, the named volumes and the default
 * network Compose names after the project. Asked of Compose by the project name it was started
 * with, so nothing is chosen by label or by pattern. Images are left out: `compose images` lists
 * pulled base images too, and those are never swept; a built image is recorded by whoever built it.
 */
export async function composeResources(exec: Exec, project: string): Promise<DockerRef[] | string> {
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter((x) => x !== "");
  const containers = await exec("docker", ["compose", "-p", project, "ps", "-a", "-q"]);
  if (containers.code !== 0) return `docker compose ps: ${containers.stderr.trim() || containers.code}`;
  const volumes = await exec("docker", ["compose", "-p", project, "config", "--volumes"]);
  if (volumes.code !== 0) return `docker compose config: ${volumes.stderr.trim() || volumes.code}`;
  return [
    ...lines(containers.stdout).map((ref) => ({ kind: "container" as const, ref })),
    ...lines(volumes.stdout).map((v) => ({ kind: "volume" as const, ref: `${project}_${v}` })),
    { kind: "network" as const, ref: `${project}_default` },
  ];
}
