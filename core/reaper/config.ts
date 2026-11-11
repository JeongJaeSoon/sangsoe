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

/**
 * What the config read found. `absent` (no file, or no `reaper` key) makes every round mark-only
 * (decisions 144, 174). `unreadable` is not "no config": its protect list is unknown, so the round
 * closes no shell and removes nothing (decision 201).
 */
export type ReaperConfigRead = { kind: "ok"; config: ReaperConfig } | { kind: "absent" } | { kind: "unreadable"; why: string };

export const DEFAULT_GRACE_MS = 30 * 60_000;
export const DEFAULT_MIN_GAP_MS = 10 * 60_000;

export const REAPER_CONFIG_PATH = "~/.config/sangsoe/config.json";

const minutes = (v: unknown, fallback: number) => (typeof v === "number" && v > 0 ? v * 60_000 : fallback);

/** The `reaper` section of the parsed config file. */
export function parseReaperConfig(raw: unknown): ReaperConfigRead {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { kind: "unreadable", why: "the file is not a JSON object" };
  if (!("reaper" in raw)) return { kind: "absent" };
  const section = (raw as { reaper: unknown }).reaper;
  if (typeof section !== "object" || section === null || Array.isArray(section)) return { kind: "unreadable", why: "reaper is not an object" };
  const s = section as Record<string, unknown>;
  const protect = s.protect;
  if (!Array.isArray(protect) || !protect.every((p) => typeof p === "string")) return { kind: "unreadable", why: "reaper.protect is not a list of strings" };
  const graceMs = minutes(s.grace_minutes, DEFAULT_GRACE_MS);
  const minGapMs = Math.min(minutes(s.min_gap_minutes, DEFAULT_MIN_GAP_MS), graceMs);
  return { kind: "ok", config: { protect, graceMs, minGapMs } };
}

/** `~/.config/sangsoe/config.json` (decision 14). Only a missing file is "absent". */
export function readReaperConfig(home: string = homedir()): ReaperConfigRead {
  let text: string;
  try {
    text = readFileSync(join(home, ".config", "sangsoe", "config.json"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", why: `read failed (${(err as NodeJS.ErrnoException).code ?? "error"})` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "unreadable", why: "the file is not valid JSON" };
  }
  return parseReaperConfig(raw);
}
