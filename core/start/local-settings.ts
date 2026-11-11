import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { WorktreeSettings } from "../models/index.ts";

export const LOCAL_SETTINGS = ".claude/settings.local.json";

/** The file's whole content: a new worktree has none of its own yet. */
export function localSettingsJson(s: WorktreeSettings): string {
  const doc: Record<string, unknown> = {};
  if (s.advisorModel) doc.advisorModel = s.advisorModel;
  if (s.disableAdvisor) doc.env = { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1" };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Decision 200: Claude Code reads a linked worktree's own `.claude/settings.local.json` (measured on
 * 2.1.322), so this is how a row's advisor reaches one session without the owner's settings. The file
 * is kept out of git: an untracked file would block the reaper's clean-tree check (decision 82 R4).
 */
export function writeLocalSettings(worktree: string, s: WorktreeSettings): void {
  mkdirSync(join(worktree, ".claude"), { recursive: true });
  writeFileSync(join(worktree, LOCAL_SETTINGS), localSettingsJson(s));
  const git = (...args: string[]) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    git("check-ignore", "-q", LOCAL_SETTINGS);
    return;
  } catch {
    // Not ignored yet: add it to the repository's own exclude file, which is never committed.
  }
  const rel = git("rev-parse", "--git-path", "info/exclude").trim();
  const exclude = isAbsolute(rel) ? rel : join(worktree, rel);
  mkdirSync(join(exclude, ".."), { recursive: true });
  appendFileSync(exclude, `\n/${LOCAL_SETTINGS}\n`);
}
