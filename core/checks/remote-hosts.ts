import { isLocalHost } from "../orca/host-filter.ts";
import type { Check } from "./check.ts";

const id = "remote-hosts";

/**
 * Decision 88 ②: non-local rows, hosts the page left out, or a connected non-local host give
 * one warning line. It never refuses the start.
 */
export const remoteHosts: Check = {
  id,
  async run({ orca }) {
    const [list, ps, hosts] = await Promise.all([orca.worktreeList({}), orca.worktreePs({}), orca.hostList()]);
    if (!list.ok || !ps.ok || !hosts.ok) {
      const code = [list, ps, hosts].flatMap((r) => (r.ok ? [] : [r.error.code])).join(", ");
      return { id, status: "warn", summary: `호스트별 행을 읽지 못해 비로컬 행을 확인하지 못했다 (${code})`, fix: "sangsoe doctor" };
    }
    const hostIds = new Set<string>([
      ...list.value.nonLocal.hostIds,
      ...ps.value.nonLocal.hostIds,
      ...list.value.omittedHostIds,
      ...ps.value.omittedHostIds,
      ...hosts.value.filter((h) => !isLocalHost(h.id) && h.connected === true).map((h) => h.id),
    ]);
    const rows = list.value.nonLocal.rows + ps.value.nonLocal.rows;
    if (hostIds.size === 0) return { id, status: "ok", summary: "이 PC 의 행만 보인다" };
    return {
      id,
      status: "warn",
      summary: `비로컬 호스트 ${hostIds.size}개(행 ${rows}개)가 보인다. 그 행은 sangsoe 가 건드리지 않는다. 그 PC 에는 자기 sangsoe 가 필요하다`,
      fix: "그 PC 에서 sangsoe install",
    };
  },
};
