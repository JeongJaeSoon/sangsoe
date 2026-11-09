// Orca plugin worker entry. Orca starts it once the plugin is approved and keeps it running while
// enabled (a `main` plus status bar items), so the timer rounds below need no outside scheduler.
import { ownKey, probeCore, probeExec, probeSqlite } from "./probe.ts";
import { type Round, startRounds } from "./timer.ts";

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

export const EVENTS = ["workspace.created", "workspace.removed", "workspace.changed", "agent.status.changed"] as const;
const STATUS_ID = "summary";
const PROBE_INTERVAL_MS = 15_000;

export default function activate(orca: OrcaWorker) {
  const startedAt = Date.now();
  const events: Record<string, { count: number; lastAt: number | null }> = {};
  for (const e of EVENTS) {
    events[e] = { count: 0, lastAt: null };
    orca.events.on(e, () => {
      const seen = events[e];
      if (seen) {
        seen.count += 1;
        seen.lastAt = Date.now();
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
  const rounds = startRounds([probeRound]);

  // T3: Orca has no host call that shows a plugin's own panel, so the command asks the CLI to.
  const openPanel = async () => {
    const list = await probeExec("orca", ["plugin", "list", "--json"], 8000, Number.POSITIVE_INFINITY);
    const key = list.ok ? ownKey(list.out) : null;
    if (!key) return `sangsoe: plugin key not found (${list.code})`;
    const open = await probeExec("orca", ["plugin", "open", key, "--panel", "probe", "--json"]);
    orca.log(`sangsoe.open: ${open.ok ? "opened" : open.out}`);
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
    return { sqlite: await probeSqlite(path), core: await probeCore() };
  });
  orca.panels.handle("probe.exec", async () => ({
    gh: await probeExec("gh", ["--version"]),
    ghApi: await probeExec("gh", ["api", "rate_limit", "--jq", ".resources.core.remaining"]),
    orca: await probeExec("orca", ["--version"]),
  }));

  void status("sangsoe", "neutral");
  orca.log(`sangsoe worker started on node ${process.version}`);
}
