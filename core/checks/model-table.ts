import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ADVISOR_FROM_SETTING,
  ADVISOR_FROM_WORKTREE,
  ADVISOR_NOT_APPLIED,
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
import { LOCAL_SETTINGS } from "../start/local-settings.ts";
import { defaultDbPath, Store } from "../store/store.ts";
import type { Check, CheckContext, CheckStatus } from "./check.ts";

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
  "stop committing .claude/settings.local.json in that repository, or set advisorModel in your own settings (the owner's act; sangsoe never writes it)";
const ADVISOR_ROUTE = `route worktree_file: ${ADVISOR_FROM_WORKTREE}`;
const ENV_OFF_FIX = "unset CLAUDE_CODE_DISABLE_ADVISOR_TOOL where Orca starts its sessions if rows should get their advisor";

/**
 * Decision 202: start_unit cannot write the advisor into a worktree of a repository that commits
 * `.claude/settings.local.json`. Read from each local main checkout Orca lists; what git or Orca
 * cannot answer is named as unchecked, never as either answer.
 */
export async function trackedLocalSettings(ctx: CheckContext): Promise<{ tracked: string[]; unchecked: string[] }> {
  const out = { tracked: [] as string[], unchecked: [] as string[] };
  const list = await ctx.orca.worktreeList({ limit: 1000 });
  if (!list.ok) return { ...out, unchecked: [`worktree list (${list.error.code})`] };
  if (list.value.truncated) out.unchecked.push("worktree list truncated");
  const seen = new Set<string>();
  for (const row of list.value.rows) {
    if (!row.isMainWorktree || seen.has(row.repoId)) continue;
    seen.add(row.repoId);
    const name = row.projectId?.replace(/^github:/, "") ?? row.displayName;
    const r = await ctx.exec("git", ["-C", row.path, "ls-files", "--error-unmatch", LOCAL_SETTINGS]).catch(() => ({ code: null }));
    if (r.code === 0) out.tracked.push(name);
    else if (r.code !== 1) out.unchecked.push(name);
  }
  return out;
}

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
    const home = ctx.home ?? homedir();
    const findings: { status: CheckStatus; text: string; fix: string }[] = [];
    const age = catalogAgeDays(now);
    if (age > STALE_DAYS) findings.push({ status: "warn", text: `모델 표 확인이 ${age}일 지났다(기준 ${STALE_DAYS}일)`, fix: FIX });
    // An unreadable version only drops this one comparison; the date floor still holds.
    const v = await ctx.exec("claude", ["--version"]).catch(() => ({ stdout: "" }));
    const installed = /\d+\.\d+\.\d+/.exec(v.stdout)?.[0];
    if (installed && compareVersions(installed, VERIFIED_WITH_CLAUDE_CODE) > 0) {
      findings.push({
        status: "notice",
        text: `Claude Code ${installed} 이 표를 확인한 ${VERIFIED_WITH_CLAUDE_CODE} 보다 새롭다: alias 가 옮겨 갔을 수 있다`,
        fix: FIX,
      });
    }
    const pins = activePins(env, home);
    if (pins.length > 0) {
      findings.push({ status: "notice", text: `alias 고정 ${pins.length}개: ${pins.join(" · ")} — 풀린 모델은 상태 줄로 확인`, fix: PIN_FIX });
    }
    // Decision 202: the advisor goes through each new worktree's local settings, not the owner's key.
    // Only where that file cannot be written does the owner's key (decision 187) matter.
    if (env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL) {
      findings.push({
        status: "notice",
        text: "이 환경에 CLAUDE_CODE_DISABLE_ADVISOR_TOOL 이 있다: 세션이 이 환경을 이어받으면 worktree 파일의 advisor 도 꺼질 수 있다",
        fix: ENV_OFF_FIX,
      });
    }
    const repos = await trackedLocalSettings(ctx);
    if (repos.tracked.length > 0) {
      const names = repos.tracked.join(" · ");
      findings.push(
        advisorSetting(env, home)
          ? {
              status: "notice",
              text: `${LOCAL_SETTINGS} 를 커밋한 저장소(${names}): worktree 파일을 쓰지 못해 advisor 는 오너 설정에서 온다(route owner_setting). ${ADVISOR_FROM_SETTING}; advisor 를 꺼야 하는 시작도 끄지 못한다`,
              fix: ADVISOR_FIX,
            }
          : {
              status: "warn",
              text: `${LOCAL_SETTINGS} 를 커밋한 저장소(${names}): ${ADVISOR_NOT_APPLIED}; 구현 워커는 바닥 tier 로 시작한다`,
              fix: ADVISOR_FIX,
            },
      );
    }
    const unchecked = repos.unchecked.length > 0 ? `; 확인 못 한 저장소: ${repos.unchecked.join(" · ")}` : "";
    const used = spendToday(home, now);
    const tail = `${unchecked}${used ? `; ${used}` : ""}`;
    if (findings.length === 0) return { id, status: "ok", summary: `모델 표 확인 ${age}일 전, 고정 없음, ${ADVISOR_ROUTE}${tail}` };
    const status = findings.reduce<CheckStatus>((s, f) => (RANK[f.status] > RANK[s] ? f.status : s), "ok");
    const fix = [...new Set(findings.map((f) => f.fix))].join("; ");
    return { id, status, summary: `${findings.map((f) => f.text).join("; ")}${tail}`, fix };
  },
};
