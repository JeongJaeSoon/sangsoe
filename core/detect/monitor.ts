import type { LoadSample } from "../capacity/capacity.ts";
import type { EventType, StoredEvent } from "../contract/index.ts";
import type { Exec, OrcaAdapter } from "../contract/orca.ts";
import type { GhClient } from "../gh/client.ts";
import type { CoreDeps } from "../notify/result.ts";
import type { Appended, EventFilter, NewEvent, StoreOnlyType } from "../store/store.ts";
import type { ChatProvider } from "./chat/provider.ts";

/** An event a round decided to write; `runMonitor` appends it, or only reports it on a dry run. */
export type Planned = NewEvent<Exclude<EventType, StoreOnlyType>>;

/**
 * A judgment's result. `unseen` names what the round could not see and so acted on nothing for.
 * `calls` names the core functions the round called, or on a dry run would have called.
 */
export type Reading = { planned: Planned[]; unseen: string[]; calls?: string[] };

export type MonitorConfig = {
  /** worker_stuck: minutes since the session's last activity while an agent is working. */
  stuckMinutes: number;
  /** wake_unconfirmed: minutes a `notified` message may stay unhandled in the Orca inbox. */
  wakeMinutes: number;
  /** waiting_decision: minutes an opened decision may wait on its open gate. */
  decisionWaitMinutes: number;
  /** worker_dead reason host_restart: this many deaths seen in one round. */
  hostRestartMin: number;
  /** capacity_free: live workers this machine takes (capacity's limit). */
  slotLimit: number;
  /** timer_stalled: the REAPER's timer period; a timer round older than three of these is a stall. */
  reaperIntervalMinutes: number;
  /** The orchestrator's Run, told of timer_stalled and of an undelivered answer one tier up. Unset: event only. */
  orchestratorRun?: string;
};

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  stuckMinutes: 30,
  wakeMinutes: 10,
  decisionWaitMinutes: 30,
  hostRestartMin: 3,
  slotLimit: 8,
  reaperIntervalMinutes: 15,
};

export type MonitorDeps = {
  /** The only way to Orca (core/orca). */
  orca: OrcaAdapter;
  /** OS commands other than `orca` (resource-monitor's `docker` lists). */
  exec: Exec;
  events(filter?: EventFilter): StoredEvent[];
  /** Absent on a dry run: the round reads and judges but writes nothing. */
  append?: (e: Planned) => Appended;
  now(): number;
  config: MonitorConfig;
  chat: ChatProvider;
  sample: () => LoadSample;
  /** Store and Orca for the core functions a queue round calls; absent on a dry run, which only names them. */
  core?: CoreDeps;
  /** GitHub reads of the verify probes (core/gh). Absent: gh probes read as unreadable. */
  gh?: GhClient;
  /** The brew tree's version job_drift compares the installed Orca plugin with. Absent: no job_drift judgment. */
  coreVersion?: string;
};

export type Written = { type: string; dedupe_key: string | null; seq: number; inserted: boolean };

export type MonitorReport = {
  monitor: MonitorName;
  planned: Planned[];
  /** Empty on a dry run, and when the round passed its cap before writing. */
  written: Written[];
  unseen: string[];
  calls: string[];
  aborted: boolean;
};

export const MONITOR_NAMES = ["orca", "resource", "chat", "queue"] as const;
export type MonitorName = (typeof MONITOR_NAMES)[number];

export const isMonitorName = (s: string): s is MonitorName => (MONITOR_NAMES as readonly string[]).includes(s);

export const minutes = (n: number) => n * 60_000;
