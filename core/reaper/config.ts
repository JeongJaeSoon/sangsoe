import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ReaperConfig = {
  /** Cards REAPER never sweeps, by instance id, path or branch name: the protect-list root. */
  protect: readonly string[];
  /** Time from a card's `seen` row before it may go. */
  graceMs: number;
  /** The floor pressure may shorten the grace to: the minimum gap between two rounds. */
  minGapMs: number;
};

export const DEFAULT_GRACE_MS = 30 * 60_000;
export const DEFAULT_MIN_GAP_MS = 10 * 60_000;

const minutes = (v: unknown, fallback: number) => (typeof v === "number" && v > 0 ? v * 60_000 : fallback);

/**
 * The `reaper` section of the config file, or null when it is absent or malformed. Null makes the
 * protect-list root unreadable, so a machine with no section only marks (decision 144).
 */
export function parseReaperConfig(raw: unknown): ReaperConfig | null {
  const section = (raw as { reaper?: unknown } | null)?.reaper;
  if (typeof section !== "object" || section === null) return null;
  const s = section as Record<string, unknown>;
  const protect = s.protect;
  if (!Array.isArray(protect) || !protect.every((p) => typeof p === "string")) return null;
  const graceMs = minutes(s.grace_minutes, DEFAULT_GRACE_MS);
  const minGapMs = Math.min(minutes(s.min_gap_minutes, DEFAULT_MIN_GAP_MS), graceMs);
  return { protect, graceMs, minGapMs };
}

/** `~/.config/sangsoe/config.json` (decision 14). */
export function readReaperConfig(home: string = homedir()): ReaperConfig | null {
  try {
    return parseReaperConfig(JSON.parse(readFileSync(join(home, ".config", "sangsoe", "config.json"), "utf8")));
  } catch {
    return null;
  }
}
