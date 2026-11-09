import { dedupeSegment, type NotifiedKey } from "../contract/index.ts";
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
}

export interface Notified {
  readonly status: "sent" | "already";
  readonly address: string;
  readonly seq: number;
}

const ID_OF: Record<Tier, keyof Chain> = { worker: "dispatch", lead: "leadRun", orchestrator: "orchestratorRun" };
const PREFIX: Record<Tier, string> = { worker: "dispatch", lead: "run", orchestrator: "run" };

/**
 * Sends one Orca message and writes `notified`, at most once per key. The first tier present in the
 * chain takes the base key; a later tier only after the tier before it was told under the same
 * condition, with its own name appended to the key (decision 0117).
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
  const at = present.indexOf(input.to);
  if (at < 0) return refuse("no_recipient", `no ${input.to} id in the chain`, `pass chain.${ID_OF[input.to]}`);
  const keyFor = (i: number) => (i === 0 ? input.key.dedupe_key : `${input.key.dedupe_key}:${dedupeSegment(present[i] ?? "")}`);
  const sent = new Map(deps.store.events({ type: "notified" }).map((e) => [e.dedupe_key, e.seq]));
  if (at > 0 && !sent.has(keyFor(at - 1))) {
    const before = present[at - 1];
    return refuse("out_of_order", `${before} has not been told yet`, `notify ${before} first; ${input.to} comes after it`);
  }
  const key = keyFor(at);
  const address = `${PREFIX[input.to]}:${input.chain[ID_OF[input.to]]}`;
  const seen = sent.get(key);
  if (seen !== undefined) return done({ status: "already", address, seq: seen });

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
  return done({ status: "sent", address, seq: row.seq });
}
