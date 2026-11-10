import type { ItemReading } from "../contract/index.ts";

/** Settings of decision 91, with its defaults. */
export interface OwnerConfig {
  /** verify.wait_minutes: a marked item whose probe stays false this long becomes "검증 안 됨" (row 11). */
  readonly waitMinutes: number;
  /** waiting.lead_minutes: an unreleased waiting_human reaches the owner after this. */
  readonly leadMinutes: number;
  /** unlinked.show_hours: an owner_act_unlinked row is shown this long. */
  readonly showHours: number;
  /** watch_commands: a `!` line starting with one of these that links to nothing is owner_act_unlinked. */
  readonly watchCommands: readonly string[];
}

export const OWNER_DEFAULTS: OwnerConfig = {
  waitMinutes: 30,
  leadMinutes: 10,
  showHours: 24,
  watchCommands: ["gh workflow run", "gh pr merge", "gh release", "sangsoe plugin approve"],
};

/**
 * What the owner queue reads about one item. U9's ItemFacts satisfies it, so the brief and this
 * module fold the item once and count it once (decision 12).
 */
export interface OwnerItemFacts {
  readonly task: string;
  readonly alias: string;
  readonly state: ItemReading;
  readonly who: string;
  readonly execBy: string | null;
  readonly whyOwner: string | null;
  readonly since: string | null;
  readonly closedAt: string | null;
}

export const isOwnerItem = (f: Pick<OwnerItemFacts, "who" | "execBy">): boolean => f.execBy === "owner" || f.who === "owner";
export const isOpenState = (s: ItemReading): boolean => s !== "done" && s !== "cancelled";
