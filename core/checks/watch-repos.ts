import { readWatchConfig } from "../detect/pr/config.ts";
import type { Check } from "./check.ts";

const id = "watch-repos";
const FILE = "~/.config/sangsoe/config.json";

// Decision 168: with no repo to watch the pr monitor reads nothing and says nothing. Which repos to
// watch is the owner's, so doctor says so instead of install writing a default (as decision 153).
// Decision 275: an entry is used as written for every GitHub call, and a private repository named in
// another case answers 404 to a fine-grained token, so the monitor read nothing and said nothing.
// Doctor asks GitHub for each entry's own name with the `gh` the monitor uses and compares.
export const watchRepos: Check = {
  id,
  async run(ctx) {
    const w = readWatchConfig(ctx.home);
    if (!w || w.repos.length === 0) {
      return {
        id,
        status: "notice",
        summary: w
          ? `pr monitor 가 아무 저장소도 보지 않는다: ${FILE} 의 watch.repos 가 비었다`
          : `pr monitor 가 아무 저장소도 보지 않는다: ${FILE} 의 watch 칸이 없거나 읽을 수 없다`,
        fix: `to let the pr monitor watch pull requests, set "watch": {"repos": ["owner/name"]} in ${FILE}`,
      };
    }
    const wrong: string[] = [];
    const unread: string[] = [];
    for (const entry of w.repos) {
      if (!/^[^/\s]+\/[^/\s]+$/.test(entry)) {
        wrong.push(`"${entry}" 는 owner/name 꼴이 아니다`);
        continue;
      }
      const r = await ctx.exec("gh", ["api", `repos/${entry}`, "--jq", ".full_name"]);
      const name = r.stdout.trim();
      if (r.code !== 0 || name === "") unread.push(entry);
      else if (name !== entry) wrong.push(`"${entry}" 는 GitHub 에서 "${name}" 이다`);
    }
    if (wrong.length > 0) {
      return { id, status: "warn", summary: `watch.repos 를 GitHub 의 이름 그대로 적어야 pr monitor 가 읽는다: ${wrong.join(" · ")}`, fix: `write each watch.repos entry in ${FILE} exactly as GitHub shows it, then sangsoe doctor` };
    }
    if (unread.length > 0) {
      return {
        id,
        status: "warn",
        summary: `GitHub 이 watch.repos 의 ${unread.join(" · ")} 을(를) 답하지 않았다: 이름의 대소문자가 다르거나, 권한이 없거나, GitHub 에 닿지 못했다`,
        fix: `gh api repos/<owner>/<name> --jq .full_name, compare the answer with the entry in ${FILE}, then sangsoe doctor`,
      };
    }
    return { id, status: "ok", summary: `pr monitor 가 저장소 ${w.repos.length}개를 보고, 이름이 GitHub 의 것과 같다` };
  },
};
