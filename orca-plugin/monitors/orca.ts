import type { MonitorSpec } from "./spec.ts";

// Liveness reads are cheap and a stuck worker costs time, so this runs often; `agent.status.changed`
// hints it in between.
export const orcaMonitor: MonitorSpec = { name: "orca", intervalMs: 60_000, capMs: 45_000 };
