import type { Check } from "./check.ts";
import { claudePluginVersion } from "./claude-plugin-version.ts";
import { modelTable } from "./model-table.ts";
import { orcaCapabilities } from "./orca-capabilities.ts";
import { orcaCommands } from "./orca-commands.ts";
import { orcaHooks } from "./orca-hooks.ts";
import { orcaPluginContent } from "./orca-plugin-content.ts";
import { orcaPluginVersion } from "./orca-plugin-version.ts";
import { orcaReachable } from "./orca-reachable.ts";
import { reaperConfig } from "./reaper-config.ts";
import { remoteHosts } from "./remote-hosts.ts";
import { sqliteVersion } from "./sqlite-version.ts";
import { storeRestore } from "./store-restore.ts";
import { tierConfig } from "./tier-config.ts";
import { watchRepos } from "./watch-repos.ts";

export * from "./check.ts";
export { activePins, advisorSetting, modelTable, spendToday } from "./model-table.ts";
export { REQUIRED_CAPABILITIES } from "./orca-capabilities.ts";

/** The start checks and `doctor` run this one list; only the formatter differs. */
export const START_CHECKS: readonly Check[] = [
  orcaReachable,
  orcaCapabilities,
  orcaCommands,
  orcaHooks,
  remoteHosts,
  claudePluginVersion,
  orcaPluginVersion,
];

/**
 * `doctor` adds what is too slow for every start (the content check downloads the reviewed build)
 * and what the start already refuses elsewhere (`Store.open` checks the SQLite floor).
 */
export const DOCTOR_CHECKS: readonly Check[] = [...START_CHECKS, orcaPluginContent, sqliteVersion, reaperConfig, tierConfig, watchRepos, modelTable, storeRestore];
