import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Setting `watch` (decision 80 N7) plus the top-level `owners`, from `~/.config/sangsoe/config.json`. */
export type WatchConfig = {
  /**
   * `owner/name` as written: GitHub calls keep this case, since a fine-grained token answers 404 for
   * a private repo named in another case. Rows and keys lowercase it. Empty: pr-monitor reads nothing.
   */
  repos: string[];
  /** Lowercase logins. Empty: any author. */
  authors: string[];
  /** Only PRs Orca's `reference find` links to a local workspace, or already recorded with `pr_opened`. */
  linkedOnly: boolean;
  /** Lowercase logins whose merge without a `land_requested` row is the owner's own act. */
  owners: string[];
};

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((s) => typeof s === "string") ? v : null);
const lower = (v: string[] | null) => v?.map((s) => s.toLowerCase()) ?? null;

/** null when `watch` is missing or malformed: the round then reads nothing (unknown means no action). */
export function parseWatch(raw: unknown): WatchConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const w = rec.watch;
  if (typeof w !== "object" || w === null) return null;
  const watch = w as Record<string, unknown>;
  const repos = strings(watch.repos);
  const authors = watch.authors === undefined ? [] : lower(strings(watch.authors));
  const owners = rec.owners === undefined ? [] : lower(strings(rec.owners));
  if (!repos || !authors || !owners) return null;
  if (watch.linked_only !== undefined && typeof watch.linked_only !== "boolean") return null;
  return { repos, authors, linkedOnly: watch.linked_only !== false, owners };
}

export function readWatchConfig(home: string = homedir()): WatchConfig | null {
  try {
    return parseWatch(JSON.parse(readFileSync(join(home, ".config", "sangsoe", "config.json"), "utf8")));
  } catch {
    return null;
  }
}
