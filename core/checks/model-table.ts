import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ADVISOR_FROM_SETTING,
  ADVISOR_NOT_APPLIED,
  CATALOG,
  catalogAgeDays,
  compareVersions,
  PIN_KEYS,
  STALE_DAYS,
  VERIFIED_WITH_CLAUDE_CODE,
} from "../models/index.ts";
import type { Check, CheckStatus } from "./check.ts";

const id = "model-table";
const FIX = "re-read the pages in core/models/README.md and update core/models/table.ts (a new decision line)";
const PIN_FIX = "the pins are the owner's settings; keep or clear them there, and confirm the model each start resolved to";

type Settings = { env?: Record<string, unknown>; modelSettings?: Record<string, unknown>; advisorModel?: unknown };

function readSettings(dir: string): Settings {
  try {
    const v = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    return typeof v === "object" && v !== null ? (v as Settings) : {};
  } catch {
    return {};
  }
}

/**
 * Pins that move what an alias resolves to, read from the environment and the user's settings.
 * Read only: sangsoe never writes Claude Code's settings.
 */
export function activePins(env: Record<string, string | undefined>, home: string): string[] {
  const settings = readSettings(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"));
  const pins: string[] = [];
  for (const key of PIN_KEYS) {
    const v = env[key] ?? settings.env?.[key];
    if (typeof v === "string" && v !== "") pins.push(`${key}=${v}`);
  }
  for (const model of Object.keys(settings.modelSettings ?? {})) pins.push(`modelSettings.${model}`);
  for (const r of CATALOG) if (r.pin) pins.push(`catalog ${r.tier}=${r.pin.id} (${r.pin.reason}, ${r.pin.since})`);
  return pins;
}

/**
 * Whether the owner's user settings name an advisor (decision 187): only the key's presence is
 * read, never its value, and the advisor's off switch counts as no advisor.
 */
export function advisorSetting(env: Record<string, string | undefined>, home: string): boolean {
  if (env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL) return false;
  const settings = readSettings(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"));
  return settings.advisorModel !== undefined && settings.advisorModel !== null && settings.advisorModel !== "";
}

const ADVISOR_FIX =
  "setting advisorModel is the owner's act (sangsoe never writes it); a frontier advisor also needs the owner's one-time usage-credits consent through /model";

const RANK: Record<CheckStatus, number> = { ok: 0, notice: 1, warn: 2, fail: 3 };

// Decision 165: the table goes stale by date, by a newer Claude Code, and by pins it cannot see.
export const modelTable: Check = {
  id,
  async run(ctx) {
    const now = ctx.now ?? new Date();
    const env = ctx.env ?? process.env;
    const findings: { status: CheckStatus; text: string }[] = [];
    const age = catalogAgeDays(now);
    if (age > STALE_DAYS) findings.push({ status: "warn", text: `모델 표 확인이 ${age}일 지났다(기준 ${STALE_DAYS}일)` });
    // An unreadable version only drops this one comparison; the date floor still holds.
    const v = await ctx.exec("claude", ["--version"]).catch(() => ({ stdout: "" }));
    const installed = /\d+\.\d+\.\d+/.exec(v.stdout)?.[0];
    if (installed && compareVersions(installed, VERIFIED_WITH_CLAUDE_CODE) > 0) {
      findings.push({ status: "notice", text: `Claude Code ${installed} 이 표를 확인한 ${VERIFIED_WITH_CLAUDE_CODE} 보다 새롭다: alias 가 옮겨 갔을 수 있다` });
    }
    const pins = activePins(env, ctx.home ?? homedir());
    if (pins.length > 0) {
      findings.push({ status: "notice", text: `alias 고정 ${pins.length}개: ${pins.join(" · ")} — 풀린 모델은 상태 줄로 확인` });
    }
    const advisor = advisorSetting(env, ctx.home ?? homedir());
    if (!advisor) findings.push({ status: "notice", text: ADVISOR_NOT_APPLIED });
    if (findings.length === 0) return { id, status: "ok", summary: `모델 표 확인 ${age}일 전, 고정 없음, ${ADVISOR_FROM_SETTING}` };
    const status = findings.reduce<CheckStatus>((s, f) => (RANK[f.status] > RANK[s] ? f.status : s), "ok");
    const fix = findings.length === 1 && pins.length > 0 ? PIN_FIX : findings.length === 1 && !advisor ? ADVISOR_FIX : FIX;
    return { id, status, summary: findings.map((f) => f.text).join("; "), fix };
  },
};
