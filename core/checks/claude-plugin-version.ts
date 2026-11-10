import type { Check } from "./check.ts";

const id = "claude-plugin-version";

type ClaudePluginRow = { id: string; version: string; scope?: string; enabled?: boolean };

/**
 * Decision 90: the Claude Code plugin must carry the core's version; a drift is a warning with its fix.
 * Decision 198: the user-scope row is the one sessions load (a project row elsewhere is not), and a
 * disabled plugin fails, so doctor is not green while sangsoe is off. No `enabled` is unknown, not on.
 */
export const claudePluginVersion: Check = {
  id,
  async run({ exec, coreVersion }) {
    const fix = "sangsoe install";
    const r = await exec("claude", ["plugin", "list", "--json"]);
    let rows: unknown;
    try {
      rows = JSON.parse(r.stdout);
    } catch {
      rows = undefined;
    }
    if (r.code !== 0 || !Array.isArray(rows)) {
      return { id, status: "warn", summary: "claude plugin list --json 을 읽지 못했다", fix };
    }
    const mine = (rows as ClaudePluginRow[]).filter((p) => typeof p.id === "string" && p.id.startsWith("sangsoe@"));
    const user = mine.find((p) => p.scope === "user") ?? (mine.every((p) => p.scope === undefined) ? mine[0] : undefined);
    if (!user) return { id, status: "warn", summary: "Claude Code 에 sangsoe plugin 이 user 범위로 없다", fix };
    if (user.enabled === false) {
      return { id, status: "fail", summary: "Claude Code 의 sangsoe plugin 이 꺼져 있다", fix: `claude plugin enable ${user.id} --scope user` };
    }
    if (user.enabled !== true) {
      return { id, status: "warn", summary: "Claude Code 의 sangsoe plugin 이 켜졌는지 모른다(enabled 칸 없음)", fix: "claude plugin list --json" };
    }
    if (user.version !== coreVersion) {
      return { id, status: "warn", summary: `Claude Code plugin ${user.version} ≠ 코어 ${coreVersion}`, fix };
    }
    return { id, status: "ok", summary: `Claude Code plugin ${user.version}, 켜짐` };
  },
};
