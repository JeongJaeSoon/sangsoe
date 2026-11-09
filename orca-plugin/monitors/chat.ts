import type { MonitorSpec } from "./spec.ts";

// With the default null provider the round reads nothing and writes nothing (decision 45).
export const chatMonitor: MonitorSpec = { name: "chat", intervalMs: 300_000, capMs: 60_000 };
