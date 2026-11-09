import { dedupeKey, eventDef } from "../contract/index.ts";
import type { Exec } from "../contract/orca.ts";
import type { Result } from "../notify/result.ts";
import { type Appended, type NewEvent, Store } from "../store/store.ts";
import { DOCKER_KINDS, type DockerRef, isDockerKind } from "./docker.ts";

export type ResourceInput = { kind: string; ref: string; owner: string; action?: "created" | "released" };
export type ResourceRecorded = { kind: string; ref: string; owner: string; action: string; seq: number; inserted: boolean };

type Appender = { append(e: NewEvent<"resource">): Appended };

const refusal = (reason: string, fix: string) => ({ ok: false, refusal: { code: "invalid_input", reason, fix } }) as const;

/**
 * The one way a resource gets an owner (R-12): whoever made it records it right after making it.
 * REAPER sweeps nothing without such a row. `owner` is the card's worktree instance id or the Orca
 * Task the work ran under.
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
  const def = eventDef("resource");
  if (!def) throw new Error("no event type resource");
  const a = store.append({
    type: "resource",
    source: "resource_record",
    payload: { action, kind, owner, ref },
    dedupe_key: dedupeKey(def, kind, ref, action),
  });
  return { ok: true, value: { kind, ref, owner, action, seq: a.seq, inserted: a.inserted } };
}

/** Opens the store on the first write, so a refused record never touches it. */
export function lazyStore(open: () => Store = () => Store.open()): Appender & { close(): void } {
  let store: Store | null = null;
  return {
    append(e) {
      if (!store) store = open();
      return store.append(e);
    },
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
