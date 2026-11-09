import { createHash } from "node:crypto";
import { dedupeSegment, type NotifiedKey } from "../contract/index.ts";
import type { ViewInput } from "../contract/views.ts";
import { type Chain, notify } from "../notify/notify.ts";
import type { CoreDeps } from "../notify/result.ts";
import { foldFacts } from "./facts.ts";
import { inEdges, readiness } from "./ready.ts";

/** One wake per item per edge set: `notify:<task>:ready:<hash>`, so a new edge set wakes once more. */
export function readyNotifiedKey(task: string, edges: readonly string[]): NotifiedKey {
  const hash = createHash("sha256").update([...edges].sort().join("\n")).digest("hex").slice(0, 12);
  return { target: task, dedupe_key: `notify:${dedupeSegment(task)}:ready:${hash}` };
}

export interface ReadyNotice {
  readonly task: string;
  readonly item: string;
  readonly status: "sent" | "already" | "no_chain" | "refused";
  readonly detail?: string;
}

/**
 * What queue-monitor runs each round: every item the ready view lists wakes its owning lead (no lead:
 * the orchestrator) once, through notify. Nothing about readiness is written; only `notified`.
 */
export async function notifyReady(deps: CoreDeps, input: ViewInput, chainOf: (task: string) => Chain | undefined): Promise<ReadyNotice[]> {
  const facts = foldFacts(input.events);
  const tasks = new Map(input.orca.tasks.map((t) => [t.id, t]));
  const out: ReadyNotice[] = [];
  for (const r of readiness(input).filter((x) => x.readiness === "ready")) {
    const chain = chainOf(r.task);
    const to = chain?.leadRun ? "lead" : chain?.orchestratorRun ? "orchestrator" : undefined;
    if (!chain || !to) {
      out.push({ task: r.task, item: r.item, status: "no_chain" });
      continue;
    }
    const key = readyNotifiedKey(r.task, inEdges(r.task, facts, tasks).map((e) => `${e.pred}|${e.kind}`));
    const sent = await notify(deps, {
      key,
      to,
      chain: { ...(chain.leadRun ? { leadRun: chain.leadRun } : {}), ...(chain.orchestratorRun ? { orchestratorRun: chain.orchestratorRun } : {}) },
      subject: `🟢 준비됨: ${r.item}`,
      body: `${r.item} (${r.task}) 의 선행이 모두 찼다. capacity 를 보고 worker-start --task 로 시작한다.`,
      source: "GRAPH",
    });
    out.push(sent.ok ? { task: r.task, item: r.item, status: sent.value.status } : { task: r.task, item: r.item, status: "refused", detail: sent.refusal.code });
  }
  return out;
}
