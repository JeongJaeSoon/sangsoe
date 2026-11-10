import { readWatchConfig } from "../detect/pr/config.ts";
import type { Check } from "./check.ts";

const id = "watch-repos";

// Decision 168: with no repo to watch the pr monitor reads nothing and says nothing. Which repos to
// watch is the owner's, so doctor says so instead of install writing a default (as decision 153).
export const watchRepos: Check = {
  id,
  async run(ctx) {
    const w = readWatchConfig(ctx.home);
    if (!w || w.repos.length === 0) {
      return {
        id,
        status: "notice",
        summary: w
          ? "pr monitor 가 아무 저장소도 보지 않는다: ~/.config/sangsoe/config.json 의 watch.repos 가 비었다"
          : "pr monitor 가 아무 저장소도 보지 않는다: ~/.config/sangsoe/config.json 의 watch 칸이 없거나 읽을 수 없다",
        fix: 'to let the pr monitor watch pull requests, set "watch": {"repos": ["owner/name"]} in ~/.config/sangsoe/config.json',
      };
    }
    return { id, status: "ok", summary: `pr monitor 가 저장소 ${w.repos.length}개를 본다` };
  },
};
