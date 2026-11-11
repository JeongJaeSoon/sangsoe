import { cpus, freemem, homedir, loadavg, totalmem } from "node:os";
import { readFileSync, statfsSync } from "node:fs";
import { join } from "node:path";

export type LoadLevel = "ok" | "warn" | "danger";

/** [warn, danger] per metric. load is "at or above", the free amounts are "at or below". */
export type LoadThresholds = {
  loadPerCpu: readonly [number, number];
  memFreePct: readonly [number, number];
  diskFreeGb: readonly [number, number];
};

/** One reading of this machine. A field that could not be measured is left out and judges nothing. */
export type LoadSample = {
  load5?: number;
  cpus?: number;
  memFreePct?: number;
  diskFreeGb?: number;
  /** The owner's thresholds for this machine (decision 210); `judgeLoad` uses them unless given its own. */
  thresholds?: LoadThresholds;
};

export const DEFAULT_THRESHOLDS: LoadThresholds = {
  loadPerCpu: [1.3, 2.0],
  memFreePct: [20, 10],
  diskFreeGb: [20, 10],
};

export type LoadVerdict = { level: LoadLevel; reasons: string[] };

const RANK: Record<LoadLevel, number> = { ok: 0, warn: 1, danger: 2 };
const LEVEL_NAME = { warn: "경고", danger: "위험" } as const;

/**
 * The one load judgment (decision 83): the pressure gate, resource-monitor, REAPER and `capacity`
 * all call this, so a machine is never "busy" to one of them and "fine" to another. Each reason
 * names the metric, its value and the threshold it crossed; the worst comes first (decision 210).
 */
export function judgeLoad(sample: LoadSample, t: LoadThresholds = sample.thresholds ?? DEFAULT_THRESHOLDS): LoadVerdict {
  const hits: { level: Exclude<LoadLevel, "ok">; why: string }[] = [];
  const check = (name: string, v: number, shown: string, [w, d]: readonly [number, number], unit: string, high: boolean) => {
    const past = (limit: number) => (high ? v >= limit : v <= limit);
    const level = past(d) ? "danger" : past(w) ? "warn" : "ok";
    if (level === "ok") return;
    hits.push({ level, why: `${name} ${shown}${unit} ${high ? "≥" : "≤"} ${LEVEL_NAME[level]} ${level === "danger" ? d : w}${unit}` });
  };

  if (sample.load5 !== undefined && sample.cpus) {
    const per = sample.load5 / sample.cpus;
    check("load/CPU", per, per.toFixed(2), t.loadPerCpu, "", true);
  }
  if (sample.memFreePct !== undefined) {
    check("메모리 여유", sample.memFreePct, String(Math.round(sample.memFreePct)), t.memFreePct, "%", false);
  }
  if (sample.diskFreeGb !== undefined) {
    check("디스크 여유", sample.diskFreeGb, String(Math.round(sample.diskFreeGb)), t.diskFreeGb, " GB", false);
  }
  hits.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { level: hits[0]?.level ?? "ok", reasons: hits.map((h) => h.why) };
}

const CONFIG_KEYS = { loadPerCpu: "load_per_cpu", memFreePct: "mem_free_pct", diskFreeGb: "disk_free_gb" } as const;

/**
 * The optional `capacity` key of `~/.config/sangsoe/config.json` (decision 210), per metric. A missing
 * or malformed entry keeps the code default, so a typo never loosens or disables the hold.
 */
export function readThresholds(home: string = homedir()): LoadThresholds {
  let section: unknown;
  try {
    section = (JSON.parse(readFileSync(join(home, ".config", "sangsoe", "config.json"), "utf8")) as { capacity?: unknown })?.capacity;
  } catch {
    return DEFAULT_THRESHOLDS;
  }
  if (typeof section !== "object" || section === null || Array.isArray(section)) return DEFAULT_THRESHOLDS;
  const out = { ...DEFAULT_THRESHOLDS };
  for (const metric of Object.keys(CONFIG_KEYS) as (keyof LoadThresholds)[]) {
    const v = (section as Record<string, unknown>)[CONFIG_KEYS[metric]];
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) continue;
    const [w, d] = v as [number, number];
    if (metric === "loadPerCpu" ? w < d : w > d) out[metric] = [w, d];
  }
  return out;
}

/**
 * Reads this machine and its owner's thresholds. On macOS `os.freemem` leaves out reclaimable cache
 * and reads a few percent on a healthy machine, so memory is left unmeasured there rather than judged busy.
 */
export function sampleLoad(home: string = homedir(), platform: string = process.platform): LoadSample {
  const sample: LoadSample = { cpus: cpus().length, thresholds: readThresholds(home) };
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
