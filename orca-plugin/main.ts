// Orca plugin worker entry. Orca starts it once the plugin is approved and keeps it running while
// enabled (a `main` plus status bar items), so the timer rounds below need no outside scheduler.
// Every static import stays inside this folder: Orca's approval and the content hash cover only it.
// The core is reached at run time through core-link.ts alone (decision 136).
import { loadPanelCore, type PanelCore } from "./core-link.ts";
import { panelHandlers } from "./panel/requests.ts";
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

export type WorkerDeps = { clock: Clock; exec: typeof probeExec; panel: () => Promise<PanelCore | string> };

export const EVENTS = ["workspace.created", "workspace.removed", "workspace.changed", "agent.status.changed"] as const;
const STATUS_ID = "summary";
const PANEL_ID = "brief";
const STATUS_INTERVAL_MS = 30_000;

let stopRounds: (() => void) | null = null;

export default function activate(orca: OrcaWorker, deps: WorkerDeps = { clock: nodeClock, exec: probeExec, panel: loadPanelCore }) {
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

  const status = (text: string, tone: Tone, tooltip?: string) =>
    orca.host
      .call("statusBar.update", { id: STATUS_ID, text, tone, ...(tooltip ? { tooltip } : {}) })
      .catch((e: unknown) => orca.log(`statusBar.update: ${e}`));

  const panel = panelHandlers(deps.panel);
  // Status bar item B (decision 92⑤): the core's summary line, redrawn each round.
  const statusRound: Round = {
    id: "status",
    intervalMs: STATUS_INTERVAL_MS,
    run: async () => {
      const s = await panel.status();
      await status(s.text, s.tone, s.tooltip);
    },
  };
  const rounds = startRounds([statusRound], clock);
  stopRounds = rounds.stop;
  orca.panels.handle("panel.brief", panel["panel.brief"]);
  orca.panels.handle("panel.act", panel["panel.act"]);

  // T3: Orca has no host call that shows a plugin's own panel, so the command asks the CLI to.
  const openPanel = async () => {
    const list = await exec("orca", ["plugin", "list", "--json"], 8000, Number.POSITIVE_INFINITY);
    const key = list.ok ? ownKey(list.out) : null;
    if (!key) return `sangsoe: plugin key not found (${list.code})`;
    const open = await exec("orca", ["plugin", "open", key, "--panel", PANEL_ID, "--json"]);
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

  void Promise.resolve()
    .then(() => statusRound.run(clock.now()))
    .catch((e: unknown) => orca.log(`status: ${e}`));
  orca.log(`sangsoe worker started on node ${process.version}`);
}

export function deactivate() {
  stopRounds?.();
  stopRounds = null;
}
