import type { OrcaAdapter } from "../contract/orca.ts";
import type { Check } from "./check.ts";

const id = "orca-plugin-content";

async function contentHash(orca: OrcaAdapter, dir: string): Promise<string | null> {
  const r = await orca.pluginInspect({ dir });
  const hash = r.ok ? r.value.contentHash : undefined;
  return typeof hash === "string" ? hash : null;
}

/**
 * Orca approves a dev folder by path, so edits and version bumps after approval run without a new
 * consent (T4). This repeats approve's comparison: the installed folder against its reviewed build.
 */
export const orcaPluginContent: Check = {
  id,
  async run({ orca, pluginBuild }) {
    if (!pluginBuild) return { id, status: "ok", summary: "이 빌드에는 Orca plugin 이 없다" };
    const here = await contentHash(orca, pluginBuild.dir);
    if (!here) {
      return { id, status: "warn", summary: `${pluginBuild.dir} 의 contentHash 를 읽지 못했다`, fix: `orca plugin inspect ${pluginBuild.dir} --json` };
    }
    const build = await pluginBuild.fetchBuild();
    if ("error" in build) return { id, status: "warn", summary: build.error, fix: build.fix };
    let reviewed: string | null;
    try {
      reviewed = await contentHash(orca, build.dir);
    } finally {
      await build.dispose();
    }
    if (!reviewed) return { id, status: "warn", summary: `빌드 커밋 ${build.commit} 의 contentHash 를 읽지 못했다`, fix: "sangsoe doctor" };
    if (reviewed !== here) {
      return {
        id,
        status: "fail",
        summary: `설치된 Orca plugin 내용 ${here} 이 빌드 커밋 ${build.commit} 의 ${reviewed} 와 다르다 (Orca 는 다시 묻지 않는다)`,
        fix: "sangsoe plugin approve",
      };
    }
    return { id, status: "ok", summary: `내용 ${here} = 빌드 커밋 ${build.commit.slice(0, 12)}` };
  },
};
