import type { Check } from "./check.ts";

/**
 * Decision 63: capability strings instead of a version floor. Each is one the core relies on:
 * the orchestration contract, auto-release of finished workers, `worktree rm --delete-branch`,
 * and an archive hook failure blocking removal (decision 86).
 */
export const REQUIRED_CAPABILITIES = [
  "orchestration.contract.v1",
  "orchestration.worker-auto-release.v1",
  "worktree.remove-branch-policy.v1",
  "worktree.archive-failure-blocking.v1",
] as const;

const id = "orca-capabilities";

export const orcaCapabilities: Check = {
  id,
  async run({ orca }) {
    const s = await orca.status();
    if (!s.ok) return { id: id, status: "fail", summary: `Orca 기능 목록을 읽지 못했다 (${s.error.code})`, fix: "orca open" };
    const have = new Set(s.value.runtime.capabilities);
    const missing = REQUIRED_CAPABILITIES.filter((c) => !have.has(c));
    if (missing.length > 0) {
      return { id: id, status: "fail", summary: `Orca 에 필요한 기능이 없다: ${missing.join(", ")}`, fix: "Orca 앱을 최신 버전으로 갱신한다" };
    }
    return { id: id, status: "ok", summary: `필요한 기능 ${REQUIRED_CAPABILITIES.length}개가 있다` };
  },
};
