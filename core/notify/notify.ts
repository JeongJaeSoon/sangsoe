import { dedupeSegment, type NotifiedKey, type StoredEvent } from "../contract/index.ts";
import { bareId } from "./address.ts";
import { receiptId } from "./receipt.ts";
import { type CoreDeps, done, type Result, refuse } from "./result.ts";

/** The receiving order of appendix #delivery; the owner is not in it. */
export const TIERS = ["worker", "lead", "orchestrator"] as const;
export type Tier = (typeof TIERS)[number];

export interface Chain {
  /** The Dispatch of the worker holding the Task. Leave out when there is none or it is dead. */
  readonly dispatch?: string;
  /** The owning lead's Run. */
  readonly leadRun?: string;
  readonly orchestratorRun?: string;
}

export interface NotifyInput {
  readonly key: NotifiedKey;
  readonly to: Tier;
  readonly chain: Chain;
  readonly subject: string;
  readonly body: string;
  readonly msgType?: string;
  readonly source?: string;
  /** Raise a condition already delivered to the next one up; without it a delivered condition is "already". */
  readonly escalate?: boolean;
}

export interface Notified {
  readonly status: "sent" | "already";
  readonly address: string;
  readonly seq: number;
}

const ID_OF: Record<Tier, keyof Chain> = { worker: "dispatch", lead: "leadRun", orchestrator: "orchestratorRun" };
const PREFIX: Record<Tier, string> = { worker: "dispatch", lead: "run", orchestrator: "run" };

// Which tier a row of this condition reached: a suffixed key names it; the base row says it by address.
function tierOf(e: StoredEvent, base: string, chain: Chain): Tier | undefined {
  const key = e.dedupe_key ?? "";
  if (key !== base) return TIERS.find((t) => key === `${base}:${dedupeSegment(t)}`);
  const to = String(e.payload.to ?? "");
  if (to.startsWith("dispatch:")) return "worker";
  return to === `run:${chain.orchestratorRun}` ? "orchestrator" : "lead";
}

/**
 * Sends one Orca message and writes `notified`, once per condition (decision 0117). A first delivery
 * goes to the first tier present in the chain and takes the base key. An escalation goes only to the
 * tier after the highest one already told, skipping tiers absent from the chain, and appends that
 * tier's name to the key. Addresses are built here from bare ids; a terminal handle is refused.
 */
export async function notify(deps: CoreDeps, input: NotifyInput): Promise<Result<Notified>> {
  const present: Tier[] = [];
  for (const tier of TIERS) {
    const id = input.chain[ID_OF[tier]];
    if (id === undefined) continue;
    const ok = bareId(id);
    if (!ok.ok) return ok;
    present.push(tier);
  }
  if (!present.includes(input.to)) {
    return refuse("no_recipient", `no ${input.to} id in the chain`, `pass chain.${ID_OF[input.to]}`);
  }
  const base = input.key.dedupe_key;
  const rows = deps.store
    .events({ type: "notified" })
    .filter((e) => e.dedupe_key === base || e.dedupe_key?.startsWith(`${base}:`));
  const told = new Map<Tier, number>();
  for (const e of rows) {
    const t = tierOf(e, base, input.chain);
    if (t) told.set(t, e.seq);
  }
  const address = `${PREFIX[input.to]}:${input.chain[ID_OF[input.to]]}`;
  const already = (seq: number) => done({ status: "already" as const, address, seq });

  let key = base;
  if (told.size === 0) {
    if (input.to !== present[0]) {
      return refuse("out_of_order", `${present[0]} comes before ${input.to}`, `notify ${present[0]} first`);
    }
  } else {
    const seen = told.get(input.to);
    if (seen !== undefined) return already(seen);
    const top = Math.max(...[...told.keys()].map((t) => TIERS.indexOf(t)));
    const at = TIERS.indexOf(input.to);
    if (!input.escalate || at < top) return already(rows[0]?.seq ?? 0);
    const skipped = present.filter((t) => TIERS.indexOf(t) > top && TIERS.indexOf(t) < at);
    if (skipped.length > 0) {
      return refuse("out_of_order", `${skipped[0]} has not been told yet`, `escalate to ${skipped[0]} first`);
    }
    key = `${base}:${dedupeSegment(input.to)}`;
  }

  const msgType = input.msgType ?? "status";
  const r = await deps.orca.send({ to: address, subject: input.subject, body: input.body, type: msgType });
  if (!r.ok) return refuse("send_failed", `orca send to ${address}: ${r.error.code} ${r.error.message}`, "retry; nothing was recorded");
  const msgId = receiptId(r.value, "message") ?? r.requestId ?? "unrecorded";
  const row = deps.store.append({
    type: "notified",
    source: input.source ?? "notify",
    target: input.key.target,
    dedupe_key: key,
    payload: { msg_id: msgId, to: address, msg_type: msgType },
  });
  return done({ status: row.inserted ? "sent" : "already", address, seq: row.seq });
}
