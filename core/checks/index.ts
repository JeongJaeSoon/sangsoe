import type { Check } from "./check.ts";
import { claudePluginVersion } from "./claude-plugin-version.ts";
import { orcaCapabilities } from "./orca-capabilities.ts";
import { orcaCommands } from "./orca-commands.ts";
import { orcaHooks } from "./orca-hooks.ts";
import { orcaPluginContent } from "./orca-plugin-content.ts";
import { orcaPluginVersion } from "./orca-plugin-version.ts";
import { orcaReachable } from "./orca-reachable.ts";
import { remoteHosts } from "./remote-hosts.ts";

export * from "./check.ts";
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

/** `doctor` adds what is too slow for every start: the content check downloads the reviewed build. */
export const DOCTOR_CHECKS: readonly Check[] = [...START_CHECKS, orcaPluginContent];
