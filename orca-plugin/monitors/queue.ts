import type { MonitorSpec } from "./spec.ts";

// Triggers, waits and probes change in minutes, and each round may spend a few gh reads (within
// gh_budget), so this runs every two minutes.
export const queueMonitor: MonitorSpec = { name: "queue", intervalMs: 120_000, capMs: 90_000 };
