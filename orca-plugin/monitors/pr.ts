import type { MonitorSpec } from "./spec.ts";

// A round costs about two GitHub list reads per watched repository plus reads only for PRs whose
// state moved, so two minutes keeps a handful of repositories far inside the hourly budget. The
// round's own walk stops between PRs at 60 s and writes per PR, so the cap is rare and cuts little (decision 329).
export const prMonitor: MonitorSpec = { name: "pr", intervalMs: 120_000, capMs: 90_000 };
