import type { Check } from "./check.ts";

const id = "orca-reachable";

export const orcaReachable: Check = {
  id,
  async run({ orca }) {
    const s = await orca.status();
    if (!s.ok) return { id: id, status: "fail", summary: `Orca 에 닿지 않는다 (${s.error.code})`, fix: "orca open" };
    const { runtime } = s.value;
    if (!runtime.reachable || runtime.state !== "ready") {
      return { id: id, status: "fail", summary: `Orca runtime 이 준비되지 않았다 (${runtime.state})`, fix: "orca open" };
    }
    return { id: id, status: "ok", summary: `Orca ${runtime.appVersion ?? "?"} runtime ready` };
  },
};
