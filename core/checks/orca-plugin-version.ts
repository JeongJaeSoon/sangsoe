import type { Check } from "./check.ts";

const id = "orca-plugin-version";

/** The key of a dev-loaded plugin is unverified (decision 90, T6), so match on its last segment. */
const isSangsoe = (key: string) => key === "sangsoe" || key.endsWith(".sangsoe");

/** Decision 90: the Orca plugin must carry the core's version and an approval for its current fingerprint. */
export const orcaPluginVersion: Check = {
  id,
  async run({ orca, coreVersion }) {
    const p = await orca.pluginList();
    if (!p.ok) return { id, status: "warn", summary: `orca plugin list 를 읽지 못했다 (${p.error.code})`, fix: "sangsoe install" };
    const mine = p.value.find((row) => isSangsoe(row.pluginKey));
    if (!mine) return { id, status: "warn", summary: "Orca 에 sangsoe plugin 이 없다", fix: "sangsoe install" };
    if (mine.version !== coreVersion) {
      return { id, status: "warn", summary: `Orca plugin ${mine.version} ≠ 코어 ${coreVersion}`, fix: "sangsoe install" };
    }
    if (mine.needsReconsent) {
      return { id, status: "warn", summary: "Orca plugin 의 지문이 바뀌어 승인을 기다린다", fix: "sangsoe plugin approve" };
    }
    return { id, status: "ok", summary: `Orca plugin ${mine.version} (${mine.status})` };
  },
};
