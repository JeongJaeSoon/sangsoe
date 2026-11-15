import { realpathSync } from "node:fs";
import type { Host } from "./host.ts";
import { type Files, realFiles, unifiedDiff, userSettingsPaths } from "./permissions.ts";
import { parseSettings, setEnvValue } from "./settings-json.ts";

// Decision 264: the one number. Skills, agents and docs point at this constant or at the doctor row.
export const AUTO_COMPACT_WINDOW = 600_000;
export const AUTO_COMPACT_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
export const AUTO_COMPACT_FIX = "sangsoe install --auto-compact";
export const AUTO_COMPACT_YES_LINE = `${AUTO_COMPACT_FIX} --yes`;

/** Doctor's fix: a Claude Code `!` line has no terminal to answer y/N on. */
export const AUTO_COMPACT_DOCTOR_FIX = `${AUTO_COMPACT_FIX} (from a Claude Code ! line: read the diff it prints, then run ${AUTO_COMPACT_YES_LINE})`;

export type WindowState = "missing" | "lower" | "equal" | "higher" | "invalid";

/** The window a settings object's env sets, compared with AUTO_COMPACT_WINDOW. `raw` is what the file holds. */
export function classifyWindow(settings: unknown): { state: WindowState; raw?: string } {
  const raw = (settings as { env?: Record<string, unknown> } | undefined)?.env?.[AUTO_COMPACT_ENV];
  if (raw === undefined) return { state: "missing" };
  const text = String(raw);
  if ((typeof raw !== "string" && typeof raw !== "number") || !/^\d+$/.test(text.trim())) return { state: "invalid", raw: text };
  const n = Number(text);
  return { state: n < AUTO_COMPACT_WINDOW ? "lower" : n === AUTO_COMPACT_WINDOW ? "equal" : "higher", raw: text };
}

const DESCRIBE: Record<WindowState, (raw: string | undefined) => string> = {
  missing: () => `${AUTO_COMPACT_ENV} is not set (want at least ${AUTO_COMPACT_WINDOW})`,
  lower: (raw) => `${raw}, below ${AUTO_COMPACT_WINDOW}`,
  invalid: (raw) => `${JSON.stringify(raw)} is not a number (want at least ${AUTO_COMPACT_WINDOW})`,
  equal: (raw) => `${raw}`,
  higher: (raw) => `${raw}, above ${AUTO_COMPACT_WINDOW}, kept`,
};

/** Doctor's row for one profile: `settings` is undefined when the file is missing or not JSON. */
export function autoCompactRow(path: string, settings: unknown): { ok: boolean; detail: string } {
  const { state, raw } = classifyWindow(settings);
  const where = settings === undefined ? `${path} (missing or not JSON)` : path;
  return { ok: state === "equal" || state === "higher", detail: `${where}: ${DESCRIBE[state](raw)}` };
}

export type AutoCompactOptions = {
  yes: boolean;
  /** Shows the diff and asks y/N; undefined when there is no terminal to ask on. */
  ask?: (text: string) => Promise<boolean>;
  files?: Files;
};

type Report = { code: number; lines: string[] };

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** `sangsoe install --auto-compact`: raises the window in each profile's settings.json after showing the diff and asking. Never lowers one. */
export async function installAutoCompact(host: Host, opts: AutoCompactOptions): Promise<Report> {
  const files = opts.files ?? realFiles;
  const lines: string[] = [];
  const changes: { path: string; before: string | undefined; after: string }[] = [];
  const seen = new Set<string>();
  for (const path of userSettingsPaths(host, "auto-compact", lines)) {
    // Two profile paths can reach one file (a symlink); the second would see the first's write as a race.
    const real = realOrSelf(path);
    if (seen.has(real)) continue;
    seen.add(real);
    let before: string | undefined;
    try {
      before = files.read(path);
    } catch (e) {
      return { code: 1, lines: [...lines, `auto-compact: cannot read ${path} (${(e as Error).message}); nothing written`] };
    }
    const text = before ?? "{}\n";
    const parsed = parseSettings(text);
    if (!parsed.ok) return { code: 1, lines: [...lines, `auto-compact: ${path} is ${parsed.reason}; nothing written. Fix the file, then run ${AUTO_COMPACT_FIX} again`] };
    const { state, raw } = classifyWindow(parsed.value);
    if (state === "equal" || state === "higher") {
      lines.push(`auto-compact: ${path} has ${raw}, ${state === "equal" ? "already the window" : `above ${AUTO_COMPACT_WINDOW}`}; nothing to write`);
      continue;
    }
    const after = setEnvValue(text, AUTO_COMPACT_ENV, String(AUTO_COMPACT_WINDOW));
    if (after === undefined) return { code: 1, lines: [...lines, `auto-compact: ${path} has an env that is not an object; nothing written`] };
    lines.push(`auto-compact: ${path}: ${raw === undefined ? "not set" : raw} -> ${AUTO_COMPACT_WINDOW}`);
    changes.push({ path, before, after });
  }
  if (changes.length === 0) return { code: 0, lines };

  const shown = changes.map((c) => unifiedDiff(c.path, c.before, c.after)).join("\n");
  if (!opts.yes) {
    if (!opts.ask) return { code: 1, lines: [...lines, shown, `auto-compact: no terminal to ask on, so nothing was written. Read the diff above, then run: ${AUTO_COMPACT_YES_LINE}`] };
    if (!(await opts.ask(`${shown}\nSet the window in ${changes.length} file(s)? [y/N] `))) return { code: 0, lines: [...lines, "auto-compact: nothing written"] };
  } else lines.push(shown);

  let code = 0;
  for (const c of changes) {
    const fail = (why: string) => {
      code = 1;
      lines.push(`auto-compact: ${c.path} ${why}; nothing written to it`);
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
      fail(`changed while sangsoe was asking. Run ${AUTO_COMPACT_FIX} again`);
      continue;
    }
    try {
      const backup = files.write(c.path, c.after);
      lines.push(`auto-compact: set the window in ${c.path}${backup ? ` (backup ${backup})` : " (new file)"}`);
    } catch (e) {
      fail(`cannot be written (${(e as Error).message})`);
    }
  }
  return { code, lines };
}
