// The one place the worker reaches the shared core (decision 136, the same path as U15's monitors).
// Orca approves and hashes only this folder, so no static import may leave it: the core is found at
// run time beside the folder, `dist/` in the installed tree and the TypeScript source in a checkout.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Reply<T> = { ok: true; value: T } | { ok: false; refusal: { code: string; reason: string; fix: string } };

/** The slice of the core's PanelCore the worker calls; declared by hand to keep the folder closed. */
export type PanelCore = {
  brief(target: { group?: string; item?: string }): Promise<Reply<unknown>>;
  statusBar(): Promise<Reply<{ text: string; tone: "neutral" | "danger"; tooltip: string }>>;
  act(a: unknown): Promise<Reply<unknown>>;
};

const CANDIDATES = ["../dist/core/index.js", "../core/index.ts"];

export function coreUrl(base: string = import.meta.url): URL | null {
  for (const rel of CANDIDATES) {
    const url = new URL(rel, base);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

/** The panel's core, or why it did not open; the worker then answers every panel request with that. */
export async function loadPanelCore(): Promise<PanelCore | string> {
  const url = coreUrl();
  if (!url) return `core not found beside the plugin folder (${CANDIDATES.join(", ")})`;
  try {
    const core = (await import(url.href)) as { openPanelCore(): PanelCore };
    return core.openPanelCore();
  } catch (e) {
    return `core at ${url.pathname} did not open: ${e instanceof Error ? e.message : String(e)}`;
  }
}
