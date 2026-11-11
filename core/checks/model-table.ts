import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ADVISOR_FROM_WORKTREE,
  CATALOG,
  catalogAgeDays,
  compareVersions,
  localDay,
  PIN_KEYS,
  STALE_DAYS,
  spend,
  spendText,
  VERIFIED_WITH_CLAUDE_CODE,
} from "../models/index.ts";
import { defaultDbPath, Store } from "../store/store.ts";
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
  "the off switch is the owner's act (sangsoe never writes user settings); a frontier advisor also needs the owner's one-time usage-credits consent through /model";
const ADVISOR_OFF = "advisor 가 사용자 환경(CLAUDE_CODE_DISABLE_ADVISOR_TOOL)에서 꺼져 있다: worktree 설정의 advisorModel 도 닿지 않는다";

const RANK: Record<CheckStatus, number> = { ok: 0, notice: 1, warn: 2, fail: 3 };

/** Decision 200: today's advisor calls and estimated cost, read from the store; nothing without one. */
export function spendToday(home: string, now: Date): string | undefined {
  const path = defaultDbPath(home);
  if (!existsSync(path)) return undefined;
  // A spend line is extra: an unreadable or locked store must not fail the model-table row.
  try {
    const store = Store.open({ path });
    try {
      return `오늘 ${spendText(spend(store.events({ type: "advisor_used" }), { day: localDay(now) }))}`;
    } finally {
      store.close();
    }
  } catch (err) {
    return `오늘 advisor 사용을 읽지 못함 (${(err as Error).message})`;
  }
}

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
    // A user-level off switch beats every worktree's advisorModel; only the owner turns it back on.
    const userEnv = readSettings(env.CLAUDE_CONFIG_DIR ?? join(ctx.home ?? homedir(), ".claude")).env;
    if (env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL || userEnv?.CLAUDE_CODE_DISABLE_ADVISOR_TOOL) {
      findings.push({ status: "notice", text: ADVISOR_OFF });
    }
    const used = spendToday(ctx.home ?? homedir(), now);
    const tail = used ? `; ${used}` : "";
    if (findings.length === 0) return { id, status: "ok", summary: `모델 표 확인 ${age}일 전, 고정 없음, ${ADVISOR_FROM_WORKTREE}${tail}` };
    const status = findings.reduce<CheckStatus>((s, f) => (RANK[f.status] > RANK[s] ? f.status : s), "ok");
    const off = findings.some((f) => f.text === ADVISOR_OFF);
    // Each finding's own fix: pins and the off switch are the owner's settings, not a table update.
    const stale = findings.length > (pins.length > 0 ? 1 : 0) + (off ? 1 : 0);
    const fix = [...(stale ? [FIX] : []), ...(pins.length > 0 ? [PIN_FIX] : []), ...(off ? [ADVISOR_FIX] : [])].join("; ");
    return { id, status, summary: `${findings.map((f) => f.text).join("; ")}${tail}`, fix };
  },
};
