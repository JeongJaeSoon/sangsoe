// Orca plugin worker entry. Orca starts it once the plugin is approved and keeps it running while
// enabled (a `main` plus status bar items), so the timer rounds below need no outside scheduler.
// Every import stays inside this folder: Orca's approval and the content hash cover only it.
import { ownKey, probeExec, probeSqlite } from "./probe.ts";
import { type Clock, nodeClock, type Round, startRounds } from "./timer.ts";

// The few host members this worker uses; `orca plugin types` cannot write the full typings on
// this Orca, so they are declared by hand.
type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
export type OrcaWorker = {
  log(message: string): void;
  host: { call(method: string, params?: unknown): Promise<unknown> };
  events: { on(event: string, handler: (payload: unknown) => void): void };
  commands: { register(id: string, handler: () => unknown): void };
  panels: { handle(name: string, handler: (input: unknown) => unknown): void };
};

export type WorkerDeps = { clock: Clock; exec: typeof probeExec };

export const EVENTS = ["workspace.created", "workspace.removed", "workspace.changed", "agent.status.changed"] as const;
const STATUS_ID = "summary";
const PROBE_INTERVAL_MS = 15_000;

let stopRounds: (() => void) | null = null;

export default function activate(orca: OrcaWorker, deps: WorkerDeps = { clock: nodeClock, exec: probeExec }) {
  const { clock, exec } = deps;
  const startedAt = clock.now();
  const events: Record<string, { count: number; lastAt: number | null }> = {};
  for (const e of EVENTS) {
    events[e] = { count: 0, lastAt: null };
    orca.events.on(e, () => {
      const seen = events[e];
      if (seen) {
        seen.count += 1;
        seen.lastAt = clock.now();
      }
    });
  }

  const status = (text: string, tone: Tone) =>
    orca.host.call("statusBar.update", { id: STATUS_ID, text, tone }).catch((e: unknown) => orca.log(`statusBar.update: ${e}`));

  // TODO(U15/U19): replace the probe round with the monitors and the BriefModel summary line.
  let ticks = 0;
  const probeRound: Round = {
    id: "probe",
    intervalMs: PROBE_INTERVAL_MS,
    run: async () => {
      ticks += 1;
      await status(`sangsoe · ${ticks}`, ticks % 2 === 0 ? "neutral" : "accent");
    },
  };
  const rounds = startRounds([probeRound], clock);
  stopRounds = rounds.stop;

  // T3: Orca has no host call that shows a plugin's own panel, so the command asks the CLI to.
  const openPanel = async () => {
    const list = await exec("orca", ["plugin", "list", "--json"], 8000, Number.POSITIVE_INFINITY);
    const key = list.ok ? ownKey(list.out) : null;
    if (!key) return `sangsoe: plugin key not found (${list.code})`;
    const open = await exec("orca", ["plugin", "open", key, "--panel", "probe", "--json"]);
    orca.log(`sangsoe.open: ${open.ok ? "opened" : open.err || open.out}`);
    return open.ok ? "sangsoe: panel opened" : `sangsoe: open failed (${open.code})`;
  };
  orca.commands.register("sangsoe.open", openPanel);
  orca.panels.handle("probe.open", openPanel);

  orca.panels.handle("probe.report", () => ({
    startedAt,
    node: process.version,
    sqlite: process.versions.sqlite ?? null,
    path: process.env.PATH ?? null,
    rounds: rounds.stats(),
    events,
  }));
  orca.panels.handle("probe.t1", async (input) => {
    const path = (input as { dbPath?: unknown } | null)?.dbPath;
    if (typeof path !== "string" || path === "") return { ok: false, error: "dbPath required" };
    return { sqlite: await probeSqlite(path) };
  });
  orca.panels.handle("probe.exec", async () => ({
    gh: await exec("gh", ["--version"]),
    ghApi: await exec("gh", ["api", "rate_limit", "--jq", ".resources.core.remaining"]),
    orca: await exec("orca", ["--version"]),
  }));

  void status("sangsoe", "neutral");
  orca.log(`sangsoe worker started on node ${process.version}`);
}

export function deactivate() {
  stopRounds?.();
  stopRounds = null;
}
