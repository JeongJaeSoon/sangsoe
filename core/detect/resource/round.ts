import type { Exec } from "../../contract/orca.ts";
import type { MonitorDeps, Reading } from "../monitor.ts";
import { type DockerObject, judgeResource, withDiagnostics } from "./judge.ts";
import { isUnfinished } from "../orca/judge.ts";

/** Ids of every container and volume, or null when `docker` or its daemon is not there. */
export async function dockerObjects(exec: Exec): Promise<DockerObject[] | null> {
  const containers = await exec("docker", ["ps", "-a", "-q", "--no-trunc"]);
  if (containers.code !== 0) return null;
  const volumes = await exec("docker", ["volume", "ls", "-q"]);
  if (volumes.code !== 0) return null;
  const ids = (out: string) => out.split("\n").map((s) => s.trim()).filter((s) => s !== "");
  return [
    ...ids(containers.stdout).map((id) => ({ kind: "container" as const, id })),
    ...ids(volumes.stdout).map((id) => ({ kind: "volume" as const, id })),
  ];
}

/** One resource-monitor round: OS reads, Orca's `diagnostics memory`, then the one load judgment. */
export async function resourceRound(d: MonitorDeps, signal: AbortSignal): Promise<Reading> {
  const [diag, workers, docker] = await Promise.all([d.orca.diagnosticsMemory(), d.orca.workerList({ limit: 100 }), dockerObjects(d.exec)]);
  const episodes = [...d.events({ type: "pressure_high" }), ...d.events({ type: "capacity_free" })].sort((a, b) => a.seq - b.seq);
  const sample = d.sample();
  const diagnostics = diag.ok ? diag.value : null;
  const reading = judgeResource(
    {
      sample,
      diagnostics,
      liveWorkers: workers.ok ? workers.value.rows.filter((w) => isUnfinished(w) && w.liveness === "live").length : null,
      lastEpisode: episodes.at(-1) ?? null,
      docker,
      resources: [...d.events({ type: "resource" }), ...d.events({ type: "resource_adopted" })].sort((a, b) => a.seq - b.seq),
    },
    d.config,
  );
  // The store is there only on a writing run; a dry round, or one aborted before this point, keeps no sample (decision 241).
  if (d.core && !signal.aborted) {
    try {
      d.core.store.recordLoadSample(withDiagnostics(sample, diagnostics));
    } catch (e) {
      reading.unseen.push(`load sample not stored: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return reading;
}
