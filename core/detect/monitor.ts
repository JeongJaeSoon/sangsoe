import type { EventType, StoredEvent } from "../contract/index.ts";
import type { Exec, OrcaAdapter } from "../contract/orca.ts";
import type { LoadSample } from "../capacity/capacity.ts";
import type { Appended, EventFilter, NewEvent, StoreOnlyType } from "../store/store.ts";
import type { ChatProvider } from "./chat/provider.ts";

/** An event a round decided to write; `runMonitor` appends it, or only reports it on a dry run. */
export type Planned = NewEvent<Exclude<EventType, StoreOnlyType>>;

/** A judgment's result. `unseen` names what the round could not see and so acted on nothing for. */
export type Reading = { planned: Planned[]; unseen: string[] };

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
};

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  stuckMinutes: 30,
  wakeMinutes: 10,
  decisionWaitMinutes: 30,
  hostRestartMin: 3,
  slotLimit: 8,
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
};

export type Written = { type: string; dedupe_key: string | null; seq: number; inserted: boolean };

export type MonitorReport = {
  monitor: MonitorName;
  planned: Planned[];
  /** Empty on a dry run, and when the round passed its cap before writing. */
  written: Written[];
  unseen: string[];
  aborted: boolean;
};

export const MONITOR_NAMES = ["orca", "resource", "chat"] as const;
export type MonitorName = (typeof MONITOR_NAMES)[number];

export const isMonitorName = (s: string): s is MonitorName => (MONITOR_NAMES as readonly string[]).includes(s);

export const minutes = (n: number) => n * 60_000;
