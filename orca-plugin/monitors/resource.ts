import type { MonitorSpec } from "./spec.ts";

// `diagnostics memory` is a point-in-time diagnostic, not a heartbeat (decision 62): a long period.
export const resourceMonitor: MonitorSpec = { name: "resource", intervalMs: 300_000, capMs: 120_000 };
