import type { LoadSample } from "../capacity/capacity.ts";
import type { EventType, StoredEvent } from "../contract/index.ts";
import type { Exec, OrcaAdapter } from "../contract/orca.ts";
import type { GhClient, RateBudget } from "../gh/client.ts";
import type { CoreDeps } from "../notify/result.ts";
import type { Appended, EventFilter, NewEvent, StoreOnlyType } from "../store/store.ts";
import type { TierConfig } from "../verify/verify-tier.ts";
import type { ChatProvider } from "./chat/provider.ts";
import type { WatchConfig } from "./pr/config.ts";

/** An event a round decided to write; `runMonitor` appends it, or only reports it on a dry run. */
export type Planned = NewEvent<Exclude<EventType, StoreOnlyType>>;

/**
 * An Orca write a round decided on (pr-monitor's Task close, `reference add`, a wake through notify).
 * `runMonitor` runs it after the planned events are appended, never on a dry run or past the cap, and
 * appends the events it returns (the `item_transition` that follows a `task-update`).
 */
export type Act = { what: string; run(d: MonitorDeps): Promise<{ ok: boolean; detail: string; planned: Planned[] }> };

/**
 * A judgment's result. `unseen` names what the round could not see and so acted on nothing for.
 * `calls` names the core functions the round called, or on a dry run would have called.
 */
export type Reading = { planned: Planned[]; unseen: string[]; acts?: Act[]; calls?: string[] };

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
  /** main_red: minutes a first-attempt failure of main's push CI waits for its one rerun. */
  mainRerunMinutes: number;
  /** pr-monitor reads main CI for merges this many hours old at most. */
  mainWatchHours: number;
  /** timer_stalled: the REAPER's timer period; a timer round older than three of these is a stall. */
  reaperIntervalMinutes: number;
};

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  stuckMinutes: 30,
  wakeMinutes: 10,
  decisionWaitMinutes: 30,
  hostRestartMin: 3,
  slotLimit: 8,
  mainRerunMinutes: 30,
  mainWatchHours: 24,
  reaperIntervalMinutes: 10,
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
  /** The brew tree's version job_drift compares the installed Orca plugin with. Absent: no job_drift judgment. */
  coreVersion?: string;
  /** GitHub reads (core/gh, the only gh caller): pr-monitor and the queue's verify probes. Absent: nothing read. */
  gh?: GhClient;
  /** The core budget the client last saw (appendix `gh_budget`): low budget narrows the pr round. */
  ghBudget?: () => RateBudget | undefined;
  watch?: () => WatchConfig | null;
  tier?: () => TierConfig | null;
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
  /** Each act the round decided on; `ok` is null when it was not run (dry run or past the cap). */
  acts: { what: string; ok: boolean | null; detail: string }[];
};

export const MONITOR_NAMES = ["orca", "resource", "chat", "pr", "queue"] as const;
export type MonitorName = (typeof MONITOR_NAMES)[number];

export const isMonitorName = (s: string): s is MonitorName => (MONITOR_NAMES as readonly string[]).includes(s);

export const minutes = (n: number) => n * 60_000;
