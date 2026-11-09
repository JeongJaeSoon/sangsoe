import { cpus, freemem, homedir, loadavg, totalmem } from "node:os";
import { statfsSync } from "node:fs";

export type LoadLevel = "ok" | "warn" | "danger";

/** One reading of this machine. A field that could not be measured is left out and judges nothing. */
export type LoadSample = {
  load5?: number;
  cpus?: number;
  memFreePct?: number;
  diskFreeGb?: number;
};

/** [warn, danger] per metric. load is "at or above", the free amounts are "at or below". */
export type LoadThresholds = {
  loadPerCpu: readonly [number, number];
  memFreePct: readonly [number, number];
  diskFreeGb: readonly [number, number];
};

export const DEFAULT_THRESHOLDS: LoadThresholds = {
  loadPerCpu: [1.3, 2.0],
  memFreePct: [20, 10],
  diskFreeGb: [50, 20],
};

export type LoadVerdict = { level: LoadLevel; reasons: string[] };

const RANK: Record<LoadLevel, number> = { ok: 0, warn: 1, danger: 2 };

/**
 * The one load judgment (decision 83): the pressure gate, resource-monitor, REAPER and `capacity`
 * all call this, so a machine is never "busy" to one of them and "fine" to another.
 */
export function judgeLoad(sample: LoadSample, t: LoadThresholds = DEFAULT_THRESHOLDS): LoadVerdict {
  let level: LoadLevel = "ok";
  const reasons: string[] = [];
  const hit = (l: LoadLevel, why: string) => {
    reasons.push(why);
    if (RANK[l] > RANK[level]) level = l;
  };
  const above = (v: number, [w, d]: readonly [number, number]): LoadLevel => (v >= d ? "danger" : v >= w ? "warn" : "ok");
  const below = (v: number, [w, d]: readonly [number, number]): LoadLevel => (v <= d ? "danger" : v <= w ? "warn" : "ok");

  if (sample.load5 !== undefined && sample.cpus) {
    const per = sample.load5 / sample.cpus;
    const l = above(per, t.loadPerCpu);
    if (l !== "ok") hit(l, `load/CPU ${per.toFixed(2)}`);
  }
  if (sample.memFreePct !== undefined) {
    const l = below(sample.memFreePct, t.memFreePct);
    if (l !== "ok") hit(l, `메모리 여유 ${Math.round(sample.memFreePct)}%`);
  }
  if (sample.diskFreeGb !== undefined) {
    const l = below(sample.diskFreeGb, t.diskFreeGb);
    if (l !== "ok") hit(l, `디스크 여유 ${Math.round(sample.diskFreeGb)} GB`);
  }
  return { level, reasons };
}

/**
 * Reads this machine. On macOS `os.freemem` leaves out reclaimable cache and reads a few percent on
 * a healthy machine, so memory is left unmeasured there rather than judged busy.
 */
export function sampleLoad(home: string = homedir(), platform: string = process.platform): LoadSample {
  const sample: LoadSample = { cpus: cpus().length };
  const load5 = loadavg()[1];
  if (load5 !== undefined) sample.load5 = load5;
  const total = totalmem();
  if (platform !== "darwin" && total > 0) sample.memFreePct = (freemem() / total) * 100;
  try {
    const s = statfsSync(home);
    sample.diskFreeGb = (s.bavail * s.bsize) / 1024 ** 3;
  } catch {
    // An unreadable volume is left out, not guessed.
  }
  return sample;
}

/** How many new workers may start now: none under danger, else the free slots under `limit`. */
export function capacity(a: { live: number; limit: number; level: LoadLevel }): number {
  if (a.level === "danger") return 0;
  return Math.max(0, a.limit - a.live);
}
