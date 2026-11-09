import type { OrcaPluginRow } from "../contract/orca.ts";
import type { Check } from "./check.ts";

const id = "orca-plugin-version";

/** The key of a dev-loaded plugin is unverified (decision 90, T6), so match on its last segment. */
const isSangsoe = (key: string) => key === "sangsoe" || key.endsWith(".sangsoe");

export type PluginDrift =
  | { kind: "missing" }
  | { kind: "version" | "reconsent" | "disabled" | "ok"; row: OrcaPluginRow };

/**
 * Decision 90's comparison, shared by this check and queue-monitor's job_drift: the installed Orca
 * plugin against the core's version and an approval for its current fingerprint.
 */
export function orcaPluginDrift(rows: readonly OrcaPluginRow[], coreVersion: string): PluginDrift {
  const row = rows.find((r) => isSangsoe(r.pluginKey));
  if (!row) return { kind: "missing" };
  if (row.version !== coreVersion) return { kind: "version", row };
  if (row.needsReconsent) return { kind: "reconsent", row };
  if (row.status === "disabled") return { kind: "disabled", row };
  return { kind: "ok", row };
}

export const orcaPluginVersion: Check = {
  id,
  async run({ orca, coreVersion }) {
    const p = await orca.pluginList();
    if (!p.ok) return { id, status: "warn", summary: `orca plugin list 를 읽지 못했다 (${p.error.code})`, fix: "sangsoe install" };
    const d = orcaPluginDrift(p.value, coreVersion);
    if (d.kind === "missing") return { id, status: "warn", summary: "Orca 에 sangsoe plugin 이 없다", fix: "sangsoe install" };
    if (d.kind === "version") {
      return { id, status: "warn", summary: `Orca plugin ${d.row.version} ≠ 코어 ${coreVersion}`, fix: "sangsoe install" };
    }
    if (d.kind === "reconsent" || d.kind === "disabled") {
      const summary = d.kind === "reconsent" ? "Orca plugin 의 지문이 바뀌어 승인을 기다린다" : "Orca plugin 이 꺼져 있다";
      return { id, status: "warn", summary, fix: "sangsoe plugin approve" };
    }
    return { id, status: "ok", summary: `Orca plugin ${d.row.version} (${d.row.status})` };
  },
};
