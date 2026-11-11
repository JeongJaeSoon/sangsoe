import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { diff } from "node:util";
import { currentProfile, type Host, orcaProfile, UNREADABLE } from "./host.ts";
import { addRules, allowList, type Created, parseSettings, removeRules } from "./settings-json.ts";

/**
 * The permissions.allow rules sangsoe's own sessions need (decision 221 lists the file:line that
 * calls each). sangsoe's MCP tools are one server rule; every Bash rule is one Orca verb.
 */
export const SANGSOE_RULES: readonly string[] = [
  "mcp__plugin_sangsoe_sangsoe",
  "Bash(orca orchestration ask:*)",
  "Bash(orca orchestration send:*)",
  "Bash(orca orchestration reply:*)",
  "Bash(orca orchestration inbox:*)",
  "Bash(orca orchestration run-create:*)",
  "Bash(orca orchestration run-use:*)",
  "Bash(orca orchestration task-list:*)",
  "Bash(orca orchestration task-update:*)",
  "Bash(orca orchestration worker-list:*)",
  "Bash(orca orchestration worker-release:*)",
  "Bash(orca worktree set:*)",
  "Bash(orca worktree show:*)",
  "Bash(orca worktree list:*)",
  "Bash(orca reference list:*)",
  "Bash(orca search:*)",
];

export const PERMISSIONS_FIX = "sangsoe install --permissions";

/** The file writes this step makes, so tests point it at a temporary home. */
export type Files = {
  /** Undefined when the file does not exist. */
  read(path: string): string | undefined;
  /** Replaces the file in one rename, following a symlink to its target. Returns the backup's path when there was a file to back up. */
  write(path: string, text: string, opts?: { backup?: boolean }): string | undefined;
  remove(path: string): void;
};

export const realFiles: Files = {
  read(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  },
  write(path, text, opts) {
    let target = path;
    // A link whose target does not exist yet (a dotfile manager's) is followed too, not replaced.
    for (let hops = 0; hops < 8 && lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink(); hops++) {
      target = resolve(dirname(target), readlinkSync(target));
    }
    mkdirSync(dirname(target), { recursive: true });
    let backup: string | undefined;
    let mode = 0o644;
    if (existsSync(target)) {
      mode = statSync(target).mode & 0o777;
      if (opts?.backup !== false) {
        backup = `${target}.sangsoe-backup`;
        copyFileSync(target, backup);
      }
    }
    const tmp = `${target}.sangsoe-tmp-${process.pid}`;
    writeFileSync(tmp, text, { mode });
    renameSync(tmp, target);
    return backup;
  },
  remove: (path) => unlinkSync(path),
};

export type Scope = "user" | "project" | "local";
export const SCOPES: readonly Scope[] = ["user", "project", "local"];

/** `inner`: what sat between the brackets sangsoe filled, put back when the last rule goes. */
type Owned = { rules: string[]; created: (Created | "file")[]; inner?: string };
type State = { targets: Record<string, Owned> };

// Which rules sangsoe added lives in sangsoe's own data directory; the rules themselves only in settings.json.
const statePath = (home: string) => join(home, ".local", "share", "sangsoe", "permissions.json");

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Throws when the record is not JSON or not in its shape, so no rule is removed on a guess. */
function readState(files: Files, home: string): State {
  const text = files.read(statePath(home));
  if (text === undefined) return { targets: {} };
  const s = JSON.parse(text) as { targets?: unknown };
  const targets = s.targets ?? {};
  if (typeof targets !== "object" || targets === null) throw new Error("targets is not an object");
  for (const [path, o] of Object.entries(targets as Record<string, Partial<Owned> | null>)) {
    if (!strings(o?.rules) || !strings(o?.created) || (o.inner !== undefined && typeof o.inner !== "string")) throw new Error(`the entry for ${path} is not in its shape`);
  }
  return { targets: targets as Record<string, Owned> };
}

function writeState(files: Files, home: string, state: State): void {
  if (Object.keys(state.targets).length === 0) {
    if (files.read(statePath(home)) !== undefined) files.remove(statePath(home));
    return;
  }
  files.write(statePath(home), `${JSON.stringify(state, null, 2)}\n`, { backup: false });
}

const CONTEXT = 3;

/** A unified diff of two texts, three lines of context per hunk. */
export function unifiedDiff(path: string, before: string | undefined, after: string): string {
  const split = (t: string) => (t === "" ? [] : t.replace(/\n$/, "").split("\n"));
  const a = split(before ?? "");
  const ops = diff(a, split(after));
  const rows: { op: 0 | 1 | -1; line: string; old: number; new: number }[] = [];
  let o = 0;
  let n = 0;
  for (const [op, line] of ops) {
    rows.push({ op, line, old: o, new: n });
    if (op !== -1) o++;
    if (op !== 1) n++;
  }
  const out = [`--- ${before === undefined ? "/dev/null" : path}`, `+++ ${path}`];
  for (let i = 0; i < rows.length; ) {
    if (rows[i]?.op === 0) {
      i++;
      continue;
    }
    const start = Math.max(0, i - CONTEXT);
    let end = i;
    for (let j = i; j < rows.length; j++) {
      if (rows[j]?.op !== 0) end = j;
      else if (j - end > 2 * CONTEXT) break;
    }
    end = Math.min(rows.length, end + 1 + CONTEXT);
    const hunk = rows.slice(start, end);
    const first = hunk[0];
    if (!first) break;
    const olds = hunk.filter((r) => r.op !== -1).length;
    const news = hunk.filter((r) => r.op !== 1).length;
    out.push(`@@ -${olds ? first.old + 1 : first.old},${olds} +${news ? first.new + 1 : first.new},${news} @@`);
    for (const r of hunk) out.push(`${r.op === 0 ? " " : r.op === 1 ? "-" : "+"}${r.line}`);
    i = end;
  }
  return out.join("\n");
}

export type PermissionOptions = {
  scope: Scope;
  /** The project whose `.claude/` the project and local scopes write. */
  cwd: string;
  yes: boolean;
  /** Shows the diff and asks y/N; undefined when there is no terminal to ask on. */
  ask?: (text: string) => Promise<boolean>;
  files?: Files;
};

type Report = { code: number; lines: string[] };

function targets(host: Host, scope: Scope, cwd: string, lines: string[]): string[] {
  if (scope === "project") return [join(cwd, ".claude", "settings.json")];
  if (scope === "local") return [join(cwd, ".claude", "settings.local.json")];
  // Decision 167: install registers the plugin in both profiles, so the rules go to both too.
  const dirs = [currentProfile(host).dir];
  const orca = orcaProfile(host);
  if (!orca) lines.push(`permissions: ${UNREADABLE("orca account list --json")} for Orca's selected profile; only ${dirs[0]} is written`);
  else if (orca.dir !== dirs[0]) dirs.push(orca.dir);
  return dirs.map((d) => join(d, "settings.json"));
}

/** `sangsoe install --permissions`: adds the missing SANGSOE_RULES after showing the diff and asking. */
export async function installPermissions(host: Host, opts: PermissionOptions): Promise<Report> {
  const files = opts.files ?? realFiles;
  const home = host.env.HOME;
  if (!home) return { code: 1, lines: ["permissions: HOME is unset, so sangsoe cannot record which rules it adds; nothing written"] };
  const lines: string[] = [];
  const changes: { path: string; before: string | undefined; after: string; add: string[]; created: Created[]; inner?: string }[] = [];
  for (const path of targets(host, opts.scope, opts.cwd, lines)) {
    let before: string | undefined;
    try {
      before = files.read(path);
    } catch (e) {
      return { code: 1, lines: [...lines, `permissions: cannot read ${path} (${(e as Error).message}); nothing written`] };
    }
    const text = before ?? "{}\n";
    const parsed = parseSettings(text);
    if (!parsed.ok) return { code: 1, lines: [...lines, `permissions: ${path} is ${parsed.reason}; nothing written. Fix the file, then run ${PERMISSIONS_FIX} again`] };
    const present = new Set(allowList(parsed.value));
    const add = SANGSOE_RULES.filter((r) => !present.has(r));
    if (add.length === 0) {
      lines.push(`permissions: ${path} already has all ${SANGSOE_RULES.length} sangsoe rules; nothing to write`);
      continue;
    }
    const spliced = addRules(text, add);
    if (!spliced) return { code: 1, lines: [...lines, `permissions: ${path} has a permissions or permissions.allow that is not an object or a list; nothing written`] };
    changes.push({ path, before, after: spliced.text, add, created: spliced.created, ...(spliced.inner !== undefined ? { inner: spliced.inner } : {}) });
  }
  if (changes.length === 0) return { code: 0, lines };

  const shown = changes.map((c) => unifiedDiff(c.path, c.before, c.after)).join("\n");
  const total = changes.reduce((s, c) => s + c.add.length, 0);
  if (!opts.yes) {
    if (!opts.ask) return { code: 1, lines: [...lines, shown, `permissions: no terminal to ask on; nothing written. Run it in a terminal, or add --yes to write without asking`] };
    if (!(await opts.ask(`${shown}\nAdd these ${total} rules? [y/N] `))) return { code: 0, lines: [...lines, "permissions: nothing written"] };
  } else lines.push(shown);

  let state: State;
  try {
    state = readState(files, home);
  } catch (e) {
    return { code: 1, lines: [...lines, `permissions: cannot read ${statePath(home)} (${(e as Error).message}); nothing written`] };
  }
  let code = 0;
  for (const c of changes) {
    const fail = (why: string) => {
      code = 1;
      lines.push(`permissions: ${c.path} ${why}; nothing written to it`);
    };
    // Whatever wrote the file while the question was open (a running session saving a setting) is not overwritten.
    let now: string | undefined;
    try {
      now = files.read(c.path);
    } catch (e) {
      fail(`cannot be read again (${(e as Error).message})`);
      continue;
    }
    if (now !== c.before) {
      fail(`changed while sangsoe was asking. Run ${PERMISSIONS_FIX} again`);
      continue;
    }
    const prev = state.targets[c.path];
    const owned: Owned = prev ? structuredClone(prev) : { rules: [], created: [] };
    owned.rules = [...owned.rules, ...c.add.filter((r) => !owned.rules.includes(r))];
    const created: (Created | "file")[] = c.before === undefined ? ["file", ...c.created] : c.created;
    owned.created = [...owned.created, ...created.filter((k) => !owned.created.includes(k))];
    if (c.inner !== undefined) owned.inner ??= c.inner;
    state.targets[c.path] = owned;
    // The record goes first, and is rolled back when the file cannot be written.
    try {
      writeState(files, home, state);
      const backup = files.write(c.path, c.after);
      lines.push(`permissions: added ${c.add.length} rules to ${c.path}${backup ? ` (backup ${backup})` : " (new file)"}`);
    } catch (e) {
      if (prev) state.targets[c.path] = prev;
      else delete state.targets[c.path];
      try {
        writeState(files, home, state);
      } catch {
        lines.push(`permissions: ${statePath(home)} could not be rolled back and may name rules ${c.path} does not hold`);
      }
      fail(`cannot be written (${(e as Error).message})`);
    }
  }
  return { code, lines };
}

/** For `sangsoe uninstall`: removes only the rules sangsoe recorded adding, where they are still present. */
export function removePermissions(host: Host, files: Files = realFiles): Report {
  const home = host.env.HOME;
  if (!home) return { code: 1, lines: ["permissions: HOME is unset, so sangsoe's record of the rules it added was not read"] };
  let state: State;
  try {
    state = readState(files, home);
  } catch (e) {
    return { code: 1, lines: [`permissions: cannot read ${statePath(home)} (${(e as Error).message}); no rule removed`] };
  }
  const paths = Object.keys(state.targets);
  if (paths.length === 0) return { code: 0, lines: ["permissions: sangsoe added no permission rules"] };
  const lines: string[] = [];
  let code = 0;
  for (const path of paths) {
    const owned = state.targets[path];
    if (!owned) continue;
    let text: string | undefined;
    try {
      text = files.read(path);
    } catch (e) {
      code = 1;
      lines.push(`permissions: cannot read ${path} (${(e as Error).message}); its sangsoe rules stay`);
      continue;
    }
    if (text === undefined) {
      lines.push(`permissions: ${path} is gone; nothing to remove`);
      delete state.targets[path];
      continue;
    }
    const created = owned.created.filter((k): k is Created => k !== "file");
    const r = removeRules(text, new Set(owned.rules), created, owned.inner);
    if (!r) {
      code = 1;
      lines.push(`permissions: ${path} is not valid JSON or not in the expected shape; its sangsoe rules stay`);
      continue;
    }
    if (r.removed.length === 0) {
      delete state.targets[path];
      lines.push(`permissions: none of the rules sangsoe added is left in ${path}`);
      continue;
    }
    try {
      if (owned.created.includes("file") && r.text.trim() === "{}") files.remove(path);
      else files.write(path, r.text);
    } catch (e) {
      code = 1;
      lines.push(`permissions: cannot write ${path} (${(e as Error).message}); its sangsoe rules stay`);
      continue;
    }
    delete state.targets[path];
    lines.push(`permissions: removed ${r.removed.length} rules sangsoe added from ${path}`);
  }
  try {
    writeState(files, home, state);
  } catch (e) {
    code = 1;
    lines.push(`permissions: cannot write ${statePath(home)} (${(e as Error).message})`);
  }
  return { code, lines };
}

/** Doctor's row: how many of SANGSOE_RULES the settings at `path` list; `settings` undefined when missing or not JSON. */
export function permissionsRow(path: string, settings: unknown): { all: boolean; detail: string } {
  const present = new Set(allowList(settings));
  const have = SANGSOE_RULES.filter((r) => present.has(r)).length;
  const m = SANGSOE_RULES.length;
  const where = settings === undefined ? `${path} (missing or not JSON)` : path;
  return { all: have === m, detail: `${have} of ${m} sangsoe rules present in ${where}` };
}
