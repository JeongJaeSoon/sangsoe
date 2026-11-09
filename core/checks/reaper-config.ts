import { readReaperConfig } from "../reaper/config.ts";
import type { Check } from "./check.ts";

const id = "reaper-config";

// Decision 153: without a `reaper` section REAPER only marks (decision 144, fail-closed). Sweeping
// is the owner's to turn on, so doctor says so instead of install writing the section.
export const reaperConfig: Check = {
  id,
  async run(ctx) {
    const c = readReaperConfig(ctx.home);
    if (!c) {
      return {
        id,
        status: "notice",
        summary: "REAPER 는 표시만 하고 정리하지 않는다: ~/.config/sangsoe/config.json 에 reaper 칸이 없거나 읽을 수 없다 (결정 144)",
        fix: 'to let REAPER sweep finished cards, add "reaper": {"protect": []} to ~/.config/sangsoe/config.json, listing cards to keep in protect',
      };
    }
    return { id, status: "ok", summary: `REAPER 정리 켜짐: 보호 ${c.protect.length}개, 유예 ${c.graceMs / 60_000}분` };
  },
};
