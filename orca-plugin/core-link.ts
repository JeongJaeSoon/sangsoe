// The one place the worker reaches the shared core (decision 132). The design has the worker import
// the core directly (decision 75 나), but Orca approves and hashes only this folder, so no static
// import may leave it. The core is found at run time beside the folder: `dist/` in the installed
// tree (libexec/orca-plugin next to libexec/dist), the TypeScript source in a checkout.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The slice of the core's MonitorRunner the worker calls; declared by hand to keep the folder closed. */
export type MonitorRunner = {
  run(
    name: string,
    signal?: AbortSignal,
  ): Promise<{ planned: unknown[]; written: unknown[]; unseen: string[]; aborted: boolean }>;
  close(): void;
};

type CoreModule = { openMonitors(o?: { dryRun?: boolean }): MonitorRunner };

const CANDIDATES = ["../dist/core/index.js", "../core/index.ts"];

export function coreUrl(base: string = import.meta.url): URL | null {
  for (const rel of CANDIDATES) {
    const url = new URL(rel, base);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

/** Opens the monitors over the store, or explains why not; the worker then runs without them. */
export async function loadMonitors(): Promise<MonitorRunner | string> {
  const url = coreUrl();
  if (!url) return `core not found beside the plugin folder (${CANDIDATES.join(", ")})`;
  try {
    const core = (await import(url.href)) as CoreModule;
    return core.openMonitors();
  } catch (e) {
    return `core at ${url.pathname} did not open: ${e instanceof Error ? e.message : String(e)}`;
  }
}
