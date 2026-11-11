import { CATALOG } from "./table.ts";

// Advisor calls read back from Claude Code's transcript (decision 200). Claude Code 2.1.322 writes each
// call as a `usage.iterations` entry of type `advisor_message` on the assistant record, with the
// advisor's model and token counts, and repeats the record once per content block: the message id
// plus the entry's place in the list is the key.

export type AdvisorCall = { key: string; model: string; input: number; output: number };

type Rec = { type?: string; message?: { id?: unknown; usage?: { iterations?: unknown } } };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

export function advisorCalls(records: readonly Rec[]): AdvisorCall[] {
  const seen = new Map<string, AdvisorCall>();
  for (const r of records) {
    const id = r.message?.id;
    const its = r.message?.usage?.iterations;
    if (r.type !== "assistant" || typeof id !== "string" || !Array.isArray(its)) continue;
    its.forEach((it: unknown, i) => {
      if (typeof it !== "object" || it === null) return;
      const x = it as Record<string, unknown>;
      if (x.type !== "advisor_message" || typeof x.model !== "string" || x.model === "") return;
      const key = `${id}:${i}`;
      if (!seen.has(key)) seen.set(key, { key, model: x.model, input: num(x.input_tokens), output: num(x.output_tokens) });
    });
  }
  return [...seen.values()];
}

/** Estimated USD at the catalog's list price; undefined for a model the catalog does not name. */
export function callCost(c: Pick<AdvisorCall, "model" | "input" | "output">): number | undefined {
  const row = CATALOG.find((r) => r.currentId === c.model || r.pin?.id === c.model);
  if (!row) return undefined;
  return (c.input * row.price.input + c.output * row.price.output) / 1_000_000;
}

export type Spend = { calls: number; usd: number; unpriced: number };

type UseEvent = { ts: string; entity_id: string | null; payload: Record<string, unknown> };

/** Sums `advisor_used` rows; `task` and `day` (local YYYY-MM-DD) narrow them. */
export function spend(events: readonly UseEvent[], filter: { task?: string; day?: string } = {}): Spend {
  const out: Spend = { calls: 0, usd: 0, unpriced: 0 };
  for (const e of events) {
    if (filter.task !== undefined && e.entity_id !== filter.task) continue;
    if (filter.day !== undefined && localDay(new Date(e.ts)) !== filter.day) continue;
    out.calls++;
    const usd = callCost({ model: String(e.payload.model ?? ""), input: num(e.payload.input_tokens), output: num(e.payload.output_tokens) });
    if (usd === undefined) out.unpriced++;
    else out.usd += usd;
  }
  return out;
}

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "advisor 3회 · 약 $0.41" (with "가격 모름 n" when a model is not in the catalog). */
export function spendText(s: Spend): string {
  const unknown = s.unpriced > 0 ? ` · 가격 모름 ${s.unpriced}` : "";
  return `advisor ${s.calls}회 · 약 $${s.usd.toFixed(2)}${unknown}`;
}
