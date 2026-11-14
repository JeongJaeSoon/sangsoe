import type { LoadVerdict } from "./types.ts";

// Decision 256: what a session runs in the background after [gate:pressure] refused a heavy start. It
// asks the gate's own load judgment (decision 83) until it reads ok twice in a row, then ends: Claude
// Code wakes the session when a background command ends, so its one exit is the one wake. It keeps no
// state outside this process and calls neither Orca nor a model.

export const PRESSURE_WAIT = { intervalMs: 30_000, okStreak: 2, deadlineMs: 2 * 60 * 60_000 } as const;

export type WaitDeps = {
  /** The judgment the pressure gate reads: judgeLoad(sampleLoad(HOME)). */
  load(): LoadVerdict;
  now(): number;
  sleep(ms: number): Promise<void>;
};

export type WaitResult = { cleared: boolean; lines: string[] };

const said = (v: LoadVerdict) => (v.reasons.length > 0 ? `${v.level}: ${v.reasons.join(", ")}` : v.level);

export async function waitForLoad(d: WaitDeps, o: typeof PRESSURE_WAIT = PRESSURE_WAIT): Promise<WaitResult> {
  const start = d.now();
  let streak = 0;
  let high: LoadVerdict | undefined;
  for (;;) {
    const v = d.load();
    if (v.level === "ok") streak += 1;
    else {
      streak = 0;
      high = v;
    }
    if (streak >= o.okStreak) {
      const was = high ? ` (was ${said(high)})` : "";
      return { cleared: true, lines: [`[pressure-wait] The load dropped${was}: run the same call again, once, unless you already ran it after the refusal.`] };
    }
    if (d.now() - start >= o.deadlineMs) {
      // The last high reading: one ok just before the deadline is not yet a drop.
      const last = high ?? v;
      const why = last.reasons.length > 0 ? ` (${last.reasons.join(", ")})` : "";
      return {
        cleared: false,
        lines: [
          `[pressure-wait] The load is still ${last.level} after ${Math.round(o.deadlineMs / 60_000)} minutes${why}: ` +
            "nothing was retried. Report the refusal to whoever gave you this work, or start this wait again.",
        ],
      };
    }
    await d.sleep(o.intervalMs);
  }
}
