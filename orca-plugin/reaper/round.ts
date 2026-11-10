import type { ReaperRunner } from "../core-link.ts";
import type { Round } from "../timer.ts";

export const REAPER_ID = "reaper";
// The sweep waits for two rounds and a 30 minute grace anyway, so a short period buys nothing.
export const REAPER_INTERVAL_MS = 600_000;
export const REAPER_CAP_MS = 300_000;

/** Events a monitor round writes that ask REAPER for an early round; they never sweep by themselves. */
export const REAPER_HINTS = new Set(["pr_merged", "pr_closed", "worker_done", "worker_dead", "pressure_high"]);

export type LastReap = { at: number; round: number; roots_ok: boolean; candidates: number; reaped: number };

/** The REAPER round on the same `startRounds` as the monitors: no second timer. */
export function reaperRound(runner: ReaperRunner, last: { value: LastReap | null }): Round {
  return {
    id: REAPER_ID,
    intervalMs: REAPER_INTERVAL_MS,
    capMs: REAPER_CAP_MS,
    run: async (at, signal, trigger) => {
      const r = await runner.run({ trigger, signal });
      last.value = { at, round: r.round, roots_ok: r.roots_ok, candidates: r.candidates.length, reaped: r.reaped.length };
    },
  };
}
