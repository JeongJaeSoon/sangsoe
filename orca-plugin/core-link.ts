// The one place the worker reaches the shared core (decisions 132, 136). The design has the worker
// import the core directly (decision 75 나), but Orca approves and hashes only this folder, so no static
// import may leave it. The core is found at run time beside the folder: `dist/` in the installed
// tree (libexec/orca-plugin next to libexec/dist), the TypeScript source in a checkout.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Reply<T> = { ok: true; value: T } | { ok: false; refusal: { code: string; reason: string; fix: string } };

/** The slice of the core's MonitorRunner the worker calls; declared by hand to keep the folder closed. */
export type MonitorRunner = {
  run(
    name: string,
    signal?: AbortSignal,
  ): Promise<{ planned: unknown[]; written: unknown[]; unseen: string[]; aborted: boolean }>;
  close(): void;
};

/** The slice of the core's ReaperRunner the worker calls. */
export type ReaperRunner = {
  run(o: { trigger: "timer" | "hint"; signal?: AbortSignal }): Promise<{
    round: number;
    roots_ok: boolean;
    candidates: unknown[];
    reaped: unknown[];
  }>;
  close(): void;
};

export type Runners = { monitors: MonitorRunner; reaper: ReaperRunner };

/** The slice of the core's PanelCore the worker calls; declared by hand for the same reason. */
export type PanelCore = {
  brief(target: { group?: string; item?: string }): Promise<Reply<unknown>>;
  statusBar(): Promise<Reply<{ text: string; tone: "neutral" | "danger"; tooltip: string }>>;
  act(a: unknown): Promise<Reply<unknown>>;
};

type CoreModule = {
  openMonitors(o?: { dryRun?: boolean }): MonitorRunner;
  openReaper(): ReaperRunner;
  openPanelCore(): PanelCore;
};

const CANDIDATES = ["../dist/core/index.js", "../core/index.ts"];

export function coreUrl(base: string = import.meta.url): URL | null {
  for (const rel of CANDIDATES) {
    const url = new URL(rel, base);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

async function open<T>(pick: (core: CoreModule) => T): Promise<T | string> {
  const url = coreUrl();
  if (!url) return `core not found beside the plugin folder (${CANDIDATES.join(", ")})`;
  try {
    return pick((await import(url.href)) as CoreModule);
  } catch (e) {
    return `core at ${url.pathname} did not open: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Opens the monitors and REAPER over the store, or explains why not; the worker then runs without them. */
export const loadRunners = (): Promise<Runners | string> =>
  open((core) => {
    const monitors = core.openMonitors();
    try {
      return { monitors, reaper: core.openReaper() };
    } catch (e) {
      monitors.close();
      throw e;
    }
  });

/** The panel's core, or why it did not open; the worker then answers every panel request with that. */
export const loadPanelCore = (): Promise<PanelCore | string> => open((core) => core.openPanelCore());
