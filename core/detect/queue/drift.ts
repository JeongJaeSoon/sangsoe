import { orcaPluginDrift } from "../../checks/orca-plugin-version.ts";
import { dedupeKey, EVENTS } from "../../contract/index.ts";
import type { OrcaPluginRow } from "../../contract/orca.ts";
import type { Planned } from "../monitor.ts";
import { QUEUE_SOURCE } from "./judge.ts";

/**
 * Decision 90: job_drift when the installed, approved Orca plugin is out of line with the brew tree
 * (the core's version, enabled, no reconsent pending). The same comparison as `sangsoe doctor`'s
 * orca-plugin-version check; content hashes stay doctor's, since they need the tree downloaded.
 */
export function judgeDrift(rows: readonly OrcaPluginRow[], coreVersion: string): Planned | null {
  const d = orcaPluginDrift(rows, coreVersion);
  if (d.kind === "ok") return null;
  const plugin = d.kind === "missing" ? "sangsoe" : d.row.pluginKey;
  const actual = d.kind === "missing" ? "missing" : `${d.row.version} ${d.row.needsReconsent ? "needs_reconsent" : d.row.status}`;
  const expected = `${coreVersion} enabled`;
  return {
    type: "job_drift",
    source: QUEUE_SOURCE,
    payload: { plugin, expected, actual },
    dedupe_key: dedupeKey(EVENTS.job_drift, plugin, expected, actual),
  };
}
