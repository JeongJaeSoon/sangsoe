import type { MonitorRunner, RoundAct } from "../core-link.ts";
import type { Round } from "../timer.ts";

/** A monitor's period and cap; what it reads and writes is the core's `MONITORS` row of the same name. */
export type MonitorSpec = { name: string; intervalMs: number; capMs: number };

/** `acts`: each Orca write the round ran, with Orca's code and message when it failed (decision 219). */
export type LastRound = { at: number; planned: number; written: number; unseen: string[]; aborted: boolean; acts: RoundAct[] };

export function monitorRound(spec: MonitorSpec, runner: MonitorRunner, last: Map<string, LastRound>): Round {
  return {
    id: spec.name,
    intervalMs: spec.intervalMs,
    capMs: spec.capMs,
    run: async (at, signal) => {
      const r = await runner.run(spec.name, signal);
      last.set(spec.name, { at, planned: r.planned.length, written: r.written.length, unseen: r.unseen, aborted: r.aborted, acts: r.acts ?? [] });
    },
  };
}
