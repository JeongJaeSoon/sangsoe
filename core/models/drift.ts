import { CATALOG, type CatalogRow } from "./table.ts";

// Decision 254: what a started session resolved to (`session_started.model`, from Claude Code's
// SessionStart input) against what start_unit passed (`unit_started.model`) and the table expects
// for it. A read over rows the store already has: nothing is written, so a drift shows again on every
// read while the newest session for that alias still disagrees, and is gone once it does not.

/** `other_tier`: another catalog row's model. `pin`: the alias's ANTHROPIC_DEFAULT_*_MODEL is set where doctor runs. */
export type DriftCause = "alias_moved" | "pin" | "other_tier";

export type Drift = {
  alias: string;
  expected: string;
  actual: string;
  cause: DriftCause;
  /** The pin key, when the cause is `pin`. */
  pin?: string;
  /** The newest session's Task and time. */
  task: string;
  at: string;
  /** Sessions of this alias that resolved to `actual`. */
  sessions: number;
};

type Ev = { ts: string; type: string; entity_id: string | null; payload: Record<string, unknown> };

/** Claude Code may add a context-window suffix such as `[1m]` to the model it reports. */
const bare = (model: string) => model.replace(/\[[^\]]*\]$/, "");

/** `events` in store order; `pins` as doctor's activePins prints them (`KEY=value`). */
export function modelDrift(events: readonly Ev[], pins: readonly string[] = []): Drift[] {
  const passed = new Map<string, CatalogRow | undefined>();
  const pairs: { row: CatalogRow; actual: string; session: string; task: string; at: string }[] = [];
  for (const e of events) {
    if (!e.entity_id) continue;
    const model = typeof e.payload.model === "string" ? e.payload.model : "";
    if (e.type === "unit_started") passed.set(e.entity_id, CATALOG.find((r) => r.alias === model || r.pin?.id === model));
    else if (e.type === "session_started" && model !== "" && model !== "unknown") {
      const row = passed.get(e.entity_id);
      // A session from before the row was last checked (or pinned) is one the table's update already saw.
      if (row && e.ts >= since(row)) pairs.push({ row, actual: bare(model), session: String(e.payload.session ?? e.ts), task: e.entity_id, at: e.ts });
    }
  }
  // Keyed by the catalog row, so starts under the alias and under its pinned id are one line.
  const newest = new Map<CatalogRow, (typeof pairs)[number]>();
  for (const p of pairs) newest.set(p.row, p);
  const out: Drift[] = [];
  for (const [row, last] of newest) {
    const expected = row.pin?.id ?? row.currentId;
    if (last.actual === expected) continue;
    const key = `ANTHROPIC_DEFAULT_${row.alias.toUpperCase()}_MODEL`;
    const pinned = pins.some((p) => p.startsWith(`${key}=`));
    const other = CATALOG.some((r) => r !== row && (r.currentId === last.actual || r.pin?.id === last.actual));
    out.push({
      alias: row.alias,
      expected,
      actual: last.actual,
      cause: pinned ? "pin" : other ? "other_tier" : "alias_moved",
      ...(pinned ? { pin: key } : {}),
      task: last.task,
      at: last.at,
      // A resumed or compacted session writes another session_started under the same id.
      sessions: new Set(pairs.filter((p) => p.row === row && p.actual === last.actual).map((p) => p.session)).size,
    });
  }
  return out;
}

const since = (row: CatalogRow) => {
  const day = row.pin && row.pin.since > row.verified ? row.pin.since : row.verified;
  return `${day}T00:00:00.000Z`;
};

const CAUSE: Record<DriftCause, string> = {
  alias_moved: "alias 가 옮겨 갔다",
  pin: "오너 설정의 고정 때문일 수 있다",
  other_tier: "다른 tier 의 모델이다",
};

/** One doctor line: the alias, the table's model, the resolved one, and the newest session. */
export function driftText(d: Drift): string {
  const why = d.cause === "pin" ? `${d.pin} ${CAUSE.pin}` : CAUSE[d.cause];
  return `alias ${d.alias} 이 표의 ${d.expected} 가 아니라 ${d.actual} 로 풀렸다(세션 ${d.sessions}개, 최근 Task ${d.task} ${d.at}): ${why}`;
}
