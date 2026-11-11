// Orca plugin worker entry. Orca starts it once the plugin is approved and keeps it running while
// enabled (a `main` plus status bar items), so the timer rounds below need no outside scheduler.
// Every static import stays inside this folder: Orca's approval and the content hash cover only it.
// The core is reached at run time through core-link.ts alone (decisions 132, 136).
import { loadPanelCore, loadRunners, type MonitorRunner, type PanelCore, type Runners } from "./core-link.ts";
import { chatMonitor } from "./monitors/chat.ts";
import { orcaMonitor } from "./monitors/orca.ts";
import { prMonitor } from "./monitors/pr.ts";
import { queueMonitor } from "./monitors/queue.ts";
import { resourceMonitor } from "./monitors/resource.ts";
import { type LastRound, monitorRound } from "./monitors/spec.ts";
import { openHandler, panelHandlers } from "./panel/requests.ts";
import { ownKey, probeExec, probeSqlite } from "./probe.ts";
import { type LastReap, REAPER_HINTS, REAPER_ID, reaperRound } from "./reaper/round.ts";
import { stallWatch } from "./stall.ts";
import { type Clock, nodeClock, type Round, startRounds } from "./timer.ts";

// The few host members this worker uses; `orca plugin types` cannot write the full typings on
// this Orca, so they are declared by hand.
type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
export type OrcaWorker = {
  log(message: string): void;
  host: { call(method: string, params?: unknown): Promise<unknown> };
  events: { on(event: string, handler: (payload: unknown) => void): void };
  commands: { register(id: string, handler: () => unknown): void };
  /** `post` reaches every open panel as `orca.plugin.on(event)`; absent on an Orca without it. */
  panels: { handle(name: string, handler: (input: unknown) => unknown): void; post?(event: string, payload: unknown): void };
};

/** `runners` is absent in tests that do not exercise them, so those never open the real store. */
export type WorkerDeps = {
  clock: Clock;
  exec: typeof probeExec;
  panel: () => Promise<PanelCore | string>;
  runners?: () => Promise<Runners | string>;
};

export const EVENTS = ["workspace.created", "workspace.removed", "workspace.changed", "agent.status.changed"] as const;
export const MONITORS = [orcaMonitor, resourceMonitor, chatMonitor, prMonitor, queueMonitor];
// Which Orca event asks which monitor for an early round (a hint; decision 83).
const HINTS: Partial<Record<(typeof EVENTS)[number], string>> = { "agent.status.changed": orcaMonitor.name };
const STATUS_ID = "summary";
const PANEL_ID = "brief";
const STATUS_INTERVAL_MS = 30_000;

let stopRounds: (() => void) | null = null;

export default function activate(
  orca: OrcaWorker,
  deps: WorkerDeps = { clock: nodeClock, exec: probeExec, panel: loadPanelCore, runners: loadRunners },
) {
  const { clock, exec } = deps;
  const startedAt = clock.now();
  const events: Record<string, { count: number; lastAt: number | null }> = {};
  let monitorRounds: ReturnType<typeof startRounds> | null = null;
  let runner: Runners | null = null;
  let stopped = false;
  const lastRounds = new Map<string, LastRound>();
  const lastReap: { value: LastReap | null } = { value: null };
  let monitorState = deps.runners ? "loading" : "off";
  let stall: ReturnType<typeof stallWatch> | null = null;
  for (const e of EVENTS) {
    events[e] = { count: 0, lastAt: null };
    orca.events.on(e, () => {
      const seen = events[e];
      if (seen) {
        seen.count += 1;
        seen.lastAt = clock.now();
      }
      const target = HINTS[e];
      if (target) monitorRounds?.hint(target);
      stall?.poke();
    });
  }

  // Panel readings now come every few seconds (decision 205): an unchanged item is not pushed again,
  // except by the 30-second round, which also repairs an item Orca reset while this worker ran.
  let shown: string | null = null;
  const status = async (text: string, tone: Tone, tooltip?: string, always = false) => {
    const key = JSON.stringify([text, tone, tooltip ?? ""]);
    if (key === shown && !always) return;
    try {
      await orca.host.call("statusBar.update", { id: STATUS_ID, text, tone, ...(tooltip ? { tooltip } : {}) });
      shown = key;
    } catch (e) {
      orca.log(`statusBar.update: ${e}`);
    }
  };

  const panel = panelHandlers(deps.panel);
  // Decision 205: Orca's one lane from this worker to its panels is `panels.post`; a new store seq goes
  // there, and each open panel re-reads within a few seconds.
  let closeWatch: (() => void) | null = null;
  const post = orca.panels.post?.bind(orca.panels);
  if (post) {
    void panel.watch((seq) => post("store.changed", { seq })).then((close) => {
      if (stopped) close?.();
      else closeWatch = close;
    });
  }
  // Status bar item B (decision 92⑤): the core's summary line, redrawn each round.
  const statusRound: Round = {
    id: "status",
    intervalMs: STATUS_INTERVAL_MS,
    run: async () => {
      const s = await panel.status();
      await status(s.text, s.tone, s.tooltip, true);
    },
  };
  const rounds = startRounds([statusRound], clock);
  // A panel refresh is one of the two things that run the stall check (decision 83).
  // Decision 198: a panel reading redraws status bar B from the same reading, so the two never disagree.
  // The panel's own interval re-read (`auto`) is a timer, so it does not run the stall check (decision 83).
  orca.panels.handle("panel.brief", async (input) => {
    if ((input as { auto?: unknown } | null)?.auto !== true) stall?.poke();
    const r = await panel["panel.brief"](input);
    const s = r.ok ? (r.value as { status?: { text: string; tone: Tone; tooltip: string } }).status : undefined;
    if (s) await status(s.text, s.tone, s.tooltip);
    return r;
  });
  orca.panels.handle("panel.act", panel["panel.act"]);
  orca.panels.handle("panel.open", openHandler(exec, panel.worktree));
  stopRounds = () => {
    stopped = true;
    closeWatch?.();
    closeWatch = null;
    void rounds.stop();
    const m = monitorRounds;
    const open = runner;
    monitorRounds = null;
    runner = null;
    stall = null;
    // A round still in flight holds the store: close it only after that round has returned.
    void (m?.stop() ?? Promise.resolve()).then(() => {
      open?.monitors.close();
      open?.reaper.close();
    });
  };

  void deps.runners?.().then((r) => {
    if (typeof r === "string") {
      monitorState = r;
      orca.log(`sangsoe monitors off: ${r}`);
      return;
    }
    if (stopped) {
      r.monitors.close();
      r.reaper.close();
      return;
    }
    runner = r;
    monitorState = "running";
    const check = r.monitors.stall?.bind(r.monitors);
    if (check) stall = stallWatch(check, clock);
    // A monitor that wrote a finishing or pressure event asks REAPER for an early round.
    const hinting: MonitorRunner = {
      run: async (name, signal) => {
        const out = await r.monitors.run(name, signal);
        if (out.written.some((w) => REAPER_HINTS.has((w as { type?: string }).type ?? ""))) monitorRounds?.hint(REAPER_ID);
        return out;
      },
      close: () => r.monitors.close(),
    };
    monitorRounds = startRounds(
      [...MONITORS.map((m) => monitorRound(m, hinting, lastRounds)), reaperRound(r.reaper, lastReap)],
      clock,
    );
  });

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

  orca.panels.handle("probe.report", () => {
    stall?.poke();
    return report();
  });
  const report = () => ({
    startedAt,
    node: process.version,
    sqlite: process.versions.sqlite ?? null,
    path: process.env.PATH ?? null,
    rounds: rounds.stats(),
    monitors: { state: monitorState, rounds: monitorRounds?.stats() ?? {}, last: Object.fromEntries(lastRounds), stall: stall?.state() ?? null },
    reaper: lastReap.value,
    events,
  });
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
    .then(() => statusRound.run(clock.now(), new AbortController().signal, "timer"))
    .catch((e: unknown) => orca.log(`status: ${e}`));
  orca.log(`sangsoe worker started on node ${process.version}`);
}

export function deactivate() {
  stopRounds?.();
  stopRounds = null;
}
