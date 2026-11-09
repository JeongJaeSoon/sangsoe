import { dedupeKey, eventDef, type StoredEvent } from "../../contract/index.ts";
import { capacity, judgeLoad, type LoadSample } from "../../capacity/capacity.ts";
import type { MonitorConfig, Planned, Reading } from "../monitor.ts";

const SOURCE = "resource-monitor";

export type DockerObject = { kind: "container" | "volume"; id: string };

export type ResourceReads = {
  sample: LoadSample;
  /** `diagnostics memory` result, or null when it could not be read. */
  diagnostics: unknown;
  liveWorkers: number | null;
  /** The last pressure_high or capacity_free row: which episode the machine is in. */
  lastEpisode: StoredEvent | null;
  /** null when `docker` is missing or its daemon did not answer. */
  docker: DockerObject[] | null;
  /** sqlite `resource` rows. */
  resources: readonly StoredEvent[];
};

const def = (t: "pressure_high" | "capacity_free" | "resource_leak") => {
  const d = eventDef(t);
  if (!d) throw new Error(`no event type ${t}`);
  return d;
};

/**
 * macOS leaves memory out of `sampleLoad` (decision 115). Orca's `diagnostics memory` host block
 * reports `availableMemory` from the OS memory-pressure reading, so it fills that field here; the
 * judgment stays `judgeLoad` (decision 83: one load function).
 */
export function withDiagnostics(sample: LoadSample, diagnostics: unknown): LoadSample {
  if (sample.memFreePct !== undefined) return sample;
  const host = (diagnostics as { host?: { availableMemory?: unknown; totalMemory?: unknown } } | null)?.host;
  const avail = host?.availableMemory;
  const total = host?.totalMemory;
  if (typeof avail !== "number" || typeof total !== "number" || total <= 0 || avail < 0) return sample;
  return { ...sample, memFreePct: (avail / total) * 100 };
}

/** Docker shows short or full ids; a record may hold either, so a prefix match either way counts. */
const recorded = (resources: readonly StoredEvent[]) => {
  const last = new Map<string, { kind: string; ref: string; created: boolean }>();
  for (const e of resources) {
    const p = e.payload as { action: string; kind: string; ref: string };
    if (p.ref) last.set(`${p.kind}\n${p.ref}`, { kind: p.kind, ref: p.ref, created: p.action === "created" });
  }
  const held = [...last.values()].filter((x) => x.created);
  return (o: DockerObject) => held.some((x) => x.kind === o.kind && (o.id.startsWith(x.ref) || x.ref.startsWith(o.id)));
};

export function judgeResource(r: ResourceReads, c: MonitorConfig): Reading {
  const planned: Planned[] = [];
  const unseen: string[] = [];
  if (r.diagnostics === null) unseen.push("diagnostics memory");

  const verdict = judgeLoad(withDiagnostics(r.sample, r.diagnostics));
  const episode = r.lastEpisode ? String(r.lastEpisode.seq) : "0";
  const inPressure = r.lastEpisode?.type === "pressure_high";
  if (verdict.level !== "ok" && !inPressure) {
    planned.push({
      type: "pressure_high",
      source: SOURCE,
      payload: { reason: [verdict.level, ...verdict.reasons].join(": ") },
      dedupe_key: dedupeKey(def("pressure_high"), episode),
    });
  }
  if (verdict.level === "ok" && inPressure) {
    if (r.liveWorkers === null) unseen.push("live worker count");
    else {
      planned.push({
        type: "capacity_free",
        source: SOURCE,
        payload: { slots: capacity({ live: r.liveWorkers, limit: c.slotLimit, level: verdict.level }) },
        dedupe_key: dedupeKey(def("capacity_free"), episode),
      });
    }
  }

  if (r.docker === null) unseen.push("docker");
  const known = recorded(r.resources);
  for (const o of r.docker ?? []) {
    if (known(o)) continue;
    planned.push({
      type: "resource_leak",
      source: SOURCE,
      payload: { kind: o.kind, ref: o.id },
      dedupe_key: dedupeKey(def("resource_leak"), o.kind, o.id),
    });
  }
  return { planned, unseen };
}
