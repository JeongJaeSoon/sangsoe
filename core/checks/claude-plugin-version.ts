import type { Check } from "./check.ts";

const id = "claude-plugin-version";

type ClaudePluginRow = { id: string; version: string; enabled?: boolean };

/** Decision 90: the Claude Code plugin must carry the core's version; a drift is a warning with its fix. */
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
    const mine = (rows as ClaudePluginRow[]).find((p) => typeof p.id === "string" && p.id.startsWith("sangsoe@"));
    if (!mine) return { id, status: "warn", summary: "Claude Code 에 sangsoe plugin 이 없다", fix };
    if (mine.enabled === false) {
      return { id, status: "warn", summary: "Claude Code 의 sangsoe plugin 이 꺼져 있다", fix: `claude plugin enable ${mine.id}` };
    }
    if (mine.version !== coreVersion) {
      return { id, status: "warn", summary: `Claude Code plugin ${mine.version} ≠ 코어 ${coreVersion}`, fix };
    }
    return { id, status: "ok", summary: `Claude Code plugin ${mine.version}` };
  },
};
