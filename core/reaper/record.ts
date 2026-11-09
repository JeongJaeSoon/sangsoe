import { dedupeKey, eventDef, type StoredEvent } from "../contract/index.ts";
import type { Exec } from "../contract/orca.ts";
import type { Result } from "../notify/result.ts";
import { type Appended, type EventFilter, type NewEvent, Store } from "../store/store.ts";
import { DOCKER_KINDS, type DockerKind, type DockerRef, isDockerKind } from "./docker.ts";

export type ResourceInput = { kind: string; ref: string; owner: string; action?: "created" | "released" };
export type ResourceRecorded = { kind: string; ref: string; owner: string; action: string; seq: number; inserted: boolean };

type Appender = { append(e: NewEvent<"resource">): Appended; events(f?: EventFilter): StoredEvent[] };

const refusal = (reason: string, fix: string, code = "invalid_input") => ({ ok: false, refusal: { code, reason, fix } }) as const;

/** Who holds one recorded Docker name now. `gen` counts how often it was let go, so a re-made name gets new keys. */
export type Hold = { kind: DockerKind; ref: string; owner: string; held: boolean; gen: number; createdSeq: number };

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
    const h = holds.get(k) ?? { kind: p.kind, ref: p.ref, owner: "", held: false, gen: 0, createdSeq: 0 };
    holds.set(k, h);
    const ends =
      (e.type === "resource" && p.action === "released") ||
      e.type === "reap_done" ||
      (e.type === "reap_blocked" && p.reason === "in_use");
    if (e.type === "resource" && p.action === "created" && !h.held) {
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
  if (!isDockerKind(kind)) {
    return refusal(`kind ${JSON.stringify(kind)}: REAPER sweeps only ${DOCKER_KINDS.join(", ")}`, "resource_record {kind: \"container\", ref, owner}");
  }
  for (const [name, v] of [["ref", ref], ["owner", owner]] as const) {
    if (typeof v !== "string" || v.trim() === "") return refusal(`${name} is empty`, `pass the Docker id as ref and the Task or worktree id as owner`);
  }
  if (action !== "created" && action !== "released") return refusal(`action ${action}`, "action is created or released");
  const hold = dockerHolds(holdEvents((f) => store.events(f))).get(`${kind}\n${ref}`);
  if (hold?.held && hold.owner !== owner) {
    return refusal(
      `${kind} ${ref} is already recorded for another owner`,
      "use a name of your own (another compose project name), or have that owner release it first",
      "held_by_other",
    );
  }
  if (action === "released" && !hold?.held) return refusal(`${kind} ${ref} is not held`, "record it as created first");
  const gen = hold?.gen ?? 0;
  const a = store.append({
    type: "resource",
    source: "resource_record",
    payload: { action, kind, owner, ref },
    dedupe_key: resourceKey(kind, ref, action, gen),
  });
  return { ok: true, value: { kind, ref, owner, action, seq: a.seq, inserted: a.inserted } };
}

/** REAPER's own close of a hold: the recorded name no longer exists in Docker. */
export function goneRow(h: Hold): NewEvent<"resource"> {
  return {
    type: "resource",
    source: "reaper",
    payload: { action: "released", kind: h.kind, owner: h.owner, ref: h.ref },
    dedupe_key: resourceKey(h.kind, h.ref, "released", h.gen),
  };
}

/** Opens the store on first use, so a refused record never touches it. */
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
  const recorded: ResourceRecorded[] = [];
  for (const r of refs) {
    const one = recordResource(store, { ...r, owner: input.owner, action });
    if (!one.ok) return one;
    recorded.push(one.value);
  }
  return { ok: true, value: { recorded } };
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
