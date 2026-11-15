import type { DatabaseSync } from "node:sqlite";

/** How long a load sample is kept (decision 241): 288 rows at the resource round's 5 minutes. */
export const SAMPLE_RETENTION_MS = 24 * 60 * 60_000;

/** The OS reads of one resource round; a field the OS did not give stays out and is stored as null. */
export type SampleReads = { load5?: number; cpus?: number; memFreePct?: number; diskFreeGb?: number };

/** Writes the sample at `at` and drops every sample 24h old or older. The caller holds the transaction. */
export function writeSample(db: DatabaseSync, at: number, s: SampleReads): void {
  db.prepare("INSERT OR REPLACE INTO load_sample (at, load5, cpus, mem_free_pct, disk_free_gb) VALUES (?, ?, ?, ?, ?)").run(
    at,
    s.load5 ?? null,
    s.cpus ?? null,
    s.memFreePct ?? null,
    s.diskFreeGb ?? null,
  );
  db.prepare("DELETE FROM load_sample WHERE at <= ?").run(at - SAMPLE_RETENTION_MS);
}

/** The spacing of samples: the resource monitor's period (`orca-plugin/monitors/resource.ts`). */
export const SAMPLE_STEP_MS = 5 * 60_000;

/** A stored sample: its time (epoch ms) and the reads it has. */
export type StoredSample = SampleReads & { at: number };

/** The samples after `since`, oldest first; reads only (decision 250). */
export function readSamples(db: DatabaseSync, since: number): StoredSample[] {
  const rows = db.prepare("SELECT at, load5, cpus, mem_free_pct, disk_free_gb FROM load_sample WHERE at > ? ORDER BY at").all(since) as {
    at: number;
    load5: number | null;
    cpus: number | null;
    mem_free_pct: number | null;
    disk_free_gb: number | null;
  }[];
  return rows.map((r) => ({
    at: r.at,
    ...(r.load5 === null ? {} : { load5: r.load5 }),
    ...(r.cpus === null ? {} : { cpus: r.cpus }),
    ...(r.mem_free_pct === null ? {} : { memFreePct: r.mem_free_pct }),
    ...(r.disk_free_gb === null ? {} : { diskFreeGb: r.disk_free_gb }),
  }));
}
