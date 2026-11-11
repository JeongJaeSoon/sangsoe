import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { WorktreeSettings } from "../models/index.ts";

export const LOCAL_SETTINGS = ".claude/settings.local.json";

/**
 * The file's content: the row's advisor keys over whatever a repo setup hook already put there
 * (permissions and the like stay).
 */
export function localSettingsJson(s: WorktreeSettings, base: Record<string, unknown> = {}): string {
  const doc: Record<string, unknown> = { ...base };
  delete doc.advisorModel;
  const env = { ...((typeof base.env === "object" && base.env) || {}) } as Record<string, unknown>;
  delete env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL;
  if (s.advisorModel) doc.advisorModel = s.advisorModel;
  if (s.disableAdvisor) env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL = "1";
  if (Object.keys(env).length > 0) doc.env = env;
  else delete doc.env;
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Decision 200: Claude Code reads a linked worktree's own `.claude/settings.local.json` (measured on
 * 2.1.322), so this is how a row's advisor reaches one session without the owner's settings. The file
 * is kept out of git: an untracked file would block the reaper's clean-tree check (decision 82 R4).
 * Everything that can fail runs before the write, so a throw leaves no file: a path that is not a
 * local git worktree (another host's, say) creates nothing here.
 */
export function writeLocalSettings(worktree: string, s: WorktreeSettings): void {
  if (!statSync(worktree).isDirectory()) throw new Error(`not a directory: ${worktree}`);
  const git = (...args: string[]) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const rel = git("rev-parse", "--git-path", "info/exclude").trim();
  let ignored = true;
  try {
    git("check-ignore", "-q", LOCAL_SETTINGS);
  } catch {
    ignored = false;
  }
  if (!ignored) {
    // The repository's own exclude file, which is never committed.
    const exclude = isAbsolute(rel) ? rel : join(worktree, rel);
    mkdirSync(join(exclude, ".."), { recursive: true });
    appendFileSync(exclude, `\n/${LOCAL_SETTINGS}\n`);
  }
  const file = join(worktree, LOCAL_SETTINGS);
  const base = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  if (!existsSync(join(worktree, ".claude"))) mkdirSync(join(worktree, ".claude"));
  writeFileSync(file, localSettingsJson(s, base));
}
