import type { MonitorSpec } from "./spec.ts";

// A round costs about two GitHub list reads per watched repository plus reads only for PRs whose
// state moved, so two minutes keeps a handful of repositories far inside the hourly budget.
export const prMonitor: MonitorSpec = { name: "pr", intervalMs: 120_000, capMs: 90_000 };
