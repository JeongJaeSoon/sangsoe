import type { OrcaAdapter } from "../contract/orca.ts";
import type { Check, CheckResult, PluginBuild } from "./check.ts";

const id = "orca-plugin-content";
const APPROVE = "sangsoe plugin approve";

async function contentHash(orca: OrcaAdapter, dir: string): Promise<string | null> {
  const r = await orca.pluginInspect({ dir });
  const hash = r.ok ? r.value.contentHash : undefined;
  return typeof hash === "string" ? hash : null;
}

// gh's own 401 line and the usual wording of a token or credential helper refusing; not 403, which is also a rate limit.
const AUTH_FAILED = /\bHTTP 401\b|Bad credentials|gh auth login|\btoken (?:is |has )?(?:expired|invalid|revoked)|(?:expired|invalid|revoked) (?:access |refresh )?token|credential/i;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

/** Decision 233: a GitHub login that failed is the reader's to fix, not a sangsoe defect, so it reads as one line. */
export function githubAuthFailed(error: string): boolean {
  return AUTH_FAILED.test(error.replace(ANSI, ""));
}

async function treeHash(orca: OrcaAdapter, build: PluginBuild, commit: string): Promise<string | CheckResult> {
  const tree = await build.fetchTree(commit);
  if ("error" in tree) {
    if (githubAuthFailed(tree.error)) {
      return {
        id,
        status: "notice",
        summary: `GitHub 인증이 실패해 ${commit.slice(0, 12)} 트리를 받지 못했고 내용을 견주지 못했다 (sangsoe 결함이 아니다)`,
        fix: "gh auth status, re-authenticate GitHub, then sangsoe doctor",
      };
    }
    return { id, status: "warn", summary: tree.error, fix: tree.fix };
  }
  try {
    return (await contentHash(orca, tree.dir)) ?? { id, status: "warn", summary: `${commit} 트리의 contentHash 를 읽지 못했다`, fix: "sangsoe doctor" };
  } finally {
    await tree.dispose();
  }
}

/**
 * Orca approves a dev folder by path, so edits and version bumps after approval run without a new
 * consent (T4). This repeats approve's comparison: the installed folder against the build commit's
 * tree and the reviewed PR head's tree.
 */
export const orcaPluginContent: Check = {
  id,
  async run({ orca, pluginBuild: build }) {
    if (!build) return { id, status: "ok", summary: "이 빌드에는 Orca plugin 폴더가 없다" };
    const here = await contentHash(orca, build.dir);
    const commit = await build.buildCommit();
    if (typeof commit !== "string") return { id, status: "warn", summary: commit.error, fix: commit.fix };

    const built = await treeHash(orca, build, commit);
    if (typeof built !== "string") return built;
    if (here === null) {
      return { id, status: "fail", summary: `${build.dir} 를 inspect 할 수 없다 (빌드 커밋 ${commit} 에는 plugin 이 있다)`, fix: "brew reinstall sangsoe" };
    }
    if (here !== built) {
      return { id, status: "fail", summary: `설치된 Orca plugin 내용 ${here} 이 빌드 커밋 ${commit} 의 ${built} 와 다르다 (Orca 는 다시 묻지 않는다)`, fix: APPROVE };
    }

    const head = await build.reviewedHead(commit);
    if (typeof head !== "string") return { id, status: "warn", summary: head.error, fix: head.fix };
    const reviewed = head === commit ? built : await treeHash(orca, build, head);
    if (typeof reviewed !== "string") return reviewed;
    if (reviewed !== here) {
      return { id, status: "fail", summary: `설치된 Orca plugin 내용 ${here} 이 리뷰된 head ${head} 의 ${reviewed} 와 다르다`, fix: APPROVE };
    }
    return { id, status: "ok", summary: `내용 ${here} = 빌드 커밋 ${commit.slice(0, 12)} = 리뷰된 head ${head.slice(0, 12)}` };
  },
};
