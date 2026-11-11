import { readReaperConfig } from "../reaper/config.ts";
import type { Check } from "./check.ts";

const id = "reaper-config";

// Decision 153: without a `reaper` section REAPER only marks (decision 144, fail-closed). Sweeping
// is the owner's to turn on, so doctor says so instead of install writing the section. A file that
// cannot be read stops every round (decision 201), which is louder than "not turned on".
export const reaperConfig: Check = {
  id,
  async run(ctx) {
    const c = readReaperConfig(ctx.home);
    if (c.kind === "unreadable") {
      return {
        id,
        status: "warn",
        summary: `REAPER 가 라운드마다 멈춘다: ~/.config/sangsoe/config.json 을 읽지 못했다 (${c.why}). 셸을 닫지 않고 아무것도 지우지 않는다 (결정 201)`,
        fix: 'fix ~/.config/sangsoe/config.json so it is a JSON object whose "reaper" is {"protect": [<strings>]}',
      };
    }
    if (c.kind === "absent") {
      return {
        id,
        status: "notice",
        summary: "REAPER 는 표시만 하고 정리하지 않는다: ~/.config/sangsoe/config.json 이나 그 reaper 칸이 없다 (결정 144)",
        fix: 'to let REAPER sweep finished cards, add "reaper": {"protect": []} to ~/.config/sangsoe/config.json, listing cards to keep in protect',
      };
    }
    return { id, status: "ok", summary: `REAPER 정리 켜짐: 보호 ${c.config.protect.length}개, 유예 ${c.config.graceMs / 60_000}분` };
  },
};
