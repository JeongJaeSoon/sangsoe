import type { LoadHistory } from "../../../orca-plugin/panel/resources.ts";

// A made-up 24 hours of 5-minute samples (decision 250): a working day's load that crosses the warn
// line once, memory around two thirds used, a disk filling slowly. No real machine's numbers.

const STEP = 5 * 60_000;
const DEFAULT = { loadPerCpu: [1.3, 2.0], memFreePct: [20, 10], diskFreeGb: [20, 10] } as const;

/** `n` samples ending at `now`, the newest last; `gapFrom`..`gapTo` (sample indexes) left out. */
export function loadHistory(now: string, n = 288, gap: [number, number] | null = null): LoadHistory {
  const to = Date.parse(now);
  const points: LoadHistory["points"] = [];
  for (let i = 0; i < n; i++) {
    if (gap && i >= gap[0] && i < gap[1]) continue;
    const t = i / 288;
    points.push({
      at: to - (n - 1 - i) * STEP,
      loadPerCpu: Math.round((0.35 + 0.6 * Math.sin(t * Math.PI) ** 2 + (i % 97 === 50 ? 0.7 : 0)) * 100) / 100,
      memUsedPct: Math.round((62 + 8 * Math.sin(t * 6)) * 10) / 10,
      diskFreeGb: Math.round((72 - 6 * t) * 10) / 10,
    });
  }
  return { from: new Date(to - 24 * 3_600_000).toISOString(), to: now, stepMs: STEP, thresholds: DEFAULT, points };
}
