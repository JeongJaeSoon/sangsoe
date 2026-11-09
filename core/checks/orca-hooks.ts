import type { Check } from "./check.ts";

/** Decision 63: Orca's status hooks off is a notice. `on` edits settings, so a person runs it, never the core. */
const id = "orca-hooks";

export const orcaHooks: Check = {
  id,
  async run({ orca }) {
    const fix = "orca agent hooks on";
    const h = await orca.agentHooksStatus();
    if (!h.ok) return { id: id, status: "notice", summary: `Orca 상태 hook 을 읽지 못했다 (${h.error.code})`, fix };
    const claude = h.value.statuses.find((s) => s.agent === "claude");
    if (!h.value.enabled || claude?.state !== "installed" || !claude.managedHooksPresent) {
      return { id: id, status: "notice", summary: "Orca 상태 hook 이 꺼져 있다: 워커의 입력 대기·멈춤을 보지 못한다", fix };
    }
    return { id: id, status: "ok", summary: "Orca 상태 hook 이 켜져 있다" };
  },
};
