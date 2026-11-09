import type { RestartDueRow, RestartDueView, RestartRules, StoredEvent } from "../contract/index.ts";

/** Design N1's four rules; config overrides each (the design holds no values beyond these defaults). */
export const DEFAULT_RESTART_RULES: RestartRules = {
  maxAutoCompactions: 3,
  firstCallShare: 0.5,
  minIntervalMinutes: 30,
  tokenCeiling: 160_000,
};

const num = (v: unknown) => (Number.isInteger(v) ? (v as number) : undefined);
const minutes = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

/**
 * Sessions due for a restart, one row per rule that holds, read from compacted and turn_ended rows
 * alone. A /clear starts a new Claude Code session id (P9), so the counts start over with it.
 */
export const restart_due: RestartDueView = (input, rules) => {
  const by = new Map<string, { compactions: StoredEvent[]; turns: StoredEvent[] }>();
  for (const e of input.events) {
    if (e.type !== "compacted" && e.type !== "turn_ended") continue;
    const s = String(e.payload.session);
    const cur = by.get(s) ?? { compactions: [], turns: [] };
    (e.type === "compacted" ? cur.compactions : cur.turns).push(e);
    by.set(s, cur);
  }
  const out: RestartDueRow[] = [];
  for (const [session, { compactions, turns }] of by) {
    const due = (rule: RestartDueRow["rule"]) => out.push({ session, rule });
    if (compactions.filter((c) => c.payload.trigger === "auto").length >= rules.maxAutoCompactions) due("compactions");
    const last = compactions.at(-1);
    const pre = num(last?.payload.pre_tokens);
    const first = last ? turns.find((t) => t.seq > last.seq && num(t.payload.context_tokens) !== undefined) : undefined;
    const firstTokens = num(first?.payload.context_tokens);
    if (pre && firstTokens !== undefined && firstTokens >= rules.firstCallShare * pre) due("first_call_half");
    const prev = compactions.at(-2);
    if (prev && last && minutes(prev.ts, last.ts) < rules.minIntervalMinutes) due("compaction_interval");
    const latest = num(turns.at(-1)?.payload.context_tokens);
    if (latest !== undefined && latest >= rules.tokenCeiling) due("token_ceiling");
  }
  return out;
};
