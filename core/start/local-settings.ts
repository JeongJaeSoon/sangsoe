import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
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
 * Decision 202: Claude Code reads a linked worktree's own `.claude/settings.local.json` over the
 * user's advisorModel (measured on 2.1.322), so this is how a row's advisor reaches one session
 * without the owner's settings. The file is kept out of git: an untracked file would block the
 * reaper's clean-tree check (decision 82 R4). Everything that can fail runs before the write, so a
 * throw leaves no file: a path that is not a local git worktree (another host's) creates nothing.
 */
export function writeLocalSettings(worktree: string, s: WorktreeSettings): void {
  const { file, base } = openLocalSettings(worktree);
  writeFileSync(file, localSettingsJson(s, base));
}

/** The file's path and its current content, after the checks that keep a write out of git and off another host. */
function openLocalSettings(worktree: string): { file: string; base: Record<string, unknown> } {
  if (!statSync(worktree).isDirectory()) throw new Error(`not a directory: ${worktree}`);
  const git = (...args: string[]) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const rel = git("rev-parse", "--git-path", "info/exclude").trim();
  // A committed file would turn into a diff the worker might push, and an exclude line cannot hide it.
  let tracked = true;
  try {
    git("ls-files", "--error-unmatch", LOCAL_SETTINGS);
  } catch {
    tracked = false;
  }
  if (tracked) throw new Error(`${LOCAL_SETTINGS} is tracked in this repository`);
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
  return { file, base };
}

// Characters a Read rule would read as a gitignore pattern or a rule boundary rather than a path.
const RULE_META = /[*?[\]\\!()]/;

/**
 * Decision 310: the allow rules that let a parent session Read its child's worktree. A `Read` rule
 * opens reads only; `additionalDirectories` would also let edits through in acceptEdits and auto
 * mode. `//` makes the path absolute: a single `/` anchors at the session's working directory.
 */
export function childReadRules(child: string): string[] {
  const paths = [child];
  try {
    paths.push(realpathSync(child));
  } catch {
    // A child not on this disk yet keeps the path Orca gave.
  }
  const out = new Set<string>();
  for (const p of paths) {
    const dir = p.replace(/\/+$/, "");
    if (!isAbsolute(dir) || dir === "" || RULE_META.test(dir)) throw new Error(`not a plain absolute path for a Read rule: ${p}`);
    out.add(`Read(/${dir}/**)`);
  }
  return [...out];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The file's `permissions.allow`; throws on a shape it would otherwise overwrite and lose. */
function allowOf(doc: unknown): { permissions: Record<string, unknown>; allow: unknown[] } {
  if (!isRecord(doc)) throw new Error(`${LOCAL_SETTINGS} is not a JSON object`);
  if (doc.permissions !== undefined && !isRecord(doc.permissions)) throw new Error(`${LOCAL_SETTINGS} permissions is not an object`);
  const permissions = { ...((doc.permissions as Record<string, unknown> | undefined) ?? {}) };
  if (permissions.allow !== undefined && !Array.isArray(permissions.allow)) throw new Error(`${LOCAL_SETTINGS} permissions.allow is not an array`);
  return { permissions, allow: [...((permissions.allow as unknown[] | undefined) ?? [])] };
}

/** Whole or not at all: a running Claude Code session watches this file and must never read half of it. */
function replaceFile(file: string, doc: Record<string, unknown>): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, file);
}

/**
 * Decision 310: adds `rules` to the parent worktree's own local settings, keeping every other key;
 * the same guards as decision 202, so a tracked file or another host's path throws and writes nothing.
 * A running Claude Code session reloads the file on change.
 */
export function addParentReadRules(parent: string, rules: readonly string[]): void {
  const { file, base } = openLocalSettings(parent);
  const { permissions, allow } = allowOf(base);
  for (const r of rules) if (!allow.includes(r)) allow.push(r);
  replaceFile(file, { ...base, permissions: { ...permissions, allow } });
}

/**
 * Takes back exactly the strings decision 310 added, when the child worktree is gone. A file that is
 * gone, unreadable or no longer holds them is left as it is.
 */
export function dropParentReadRules(parent: string, rules: readonly string[]): boolean {
  const file = join(parent, LOCAL_SETTINGS);
  let base: unknown;
  let found: ReturnType<typeof allowOf>;
  try {
    base = JSON.parse(readFileSync(file, "utf8"));
    found = allowOf(base);
  } catch {
    return false;
  }
  const kept = found.allow.filter((r) => !(typeof r === "string" && rules.includes(r)));
  if (kept.length === found.allow.length) return false;
  replaceFile(file, { ...(base as Record<string, unknown>), permissions: { ...found.permissions, allow: kept } });
  return true;
}
