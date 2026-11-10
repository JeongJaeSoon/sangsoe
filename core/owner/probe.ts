import type { VerifySpec, ViewInput } from "../contract/index.ts";
import { dedupeKey, EVENTS } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { budgetLevel, type GhClient, type RateBudget } from "../gh/client.ts";
import type { Store } from "../store/store.ts";
import { type OwnerItemMarks, ownerMarks, verifyWithRun } from "./marks.ts";
import { isOpenState, isOwnerItem, OWNER_DEFAULTS, type OwnerConfig, type OwnerItemFacts } from "./types.ts";

export type ProbeRead =
  | { readonly kind: "true"; readonly observed: string }
  | { readonly kind: "false"; readonly observed: string }
  | { readonly kind: "unreadable"; readonly why: string };

/** Orca through U2's adapter, GitHub through core/gh: the only ways a probe reads (decision 91②). */
export interface ProbePorts {
  readonly orca: Pick<OrcaAdapter, "taskList" | "pluginList">;
  readonly gh: GhClient;
  /** The last gh_budget reading; below 10% no gh probe runs. */
  readonly budget?: RateBudget;
  /** `watch.repos` as the owner spelled them: a verify's repo is lowercase, a private repo is not found that way. */
  readonly repos?: readonly string[];
}

// The rule pr-monitor keeps (PR 45, U37): GitHub under the configured spelling, rows lowercase.
const spelled = (ports: ProbePorts, repo: string) => ports.repos?.find((r) => r.toLowerCase() === repo.toLowerCase()) ?? repo;

/** The five verify kinds, fixed (decision 91②). The last two read only while the item is marked. */
export const VERIFY_KINDS = ["pr_merged", "orca_field", "plugin_approved", "run_ok", "pr_found"] as const;
export const MARKED_ONLY: ReadonlySet<string> = new Set(["run_ok", "pr_found"]);
const GH_KINDS: ReadonlySet<string> = new Set(["pr_merged", "run_ok", "pr_found"]);

const ORCA_FIELDS = ["status", "dispatchId", "assignee", "result"] as const;

async function gh<T>(ports: ProbePorts, path: string): Promise<{ ok: true; data: T } | { ok: false; why: string }> {
  const r = await ports.gh.get<T>(path);
  if (r.kind === "ok") return { ok: true, data: r.data };
  if (r.kind === "rate_limited") return { ok: false, why: `rate_limited ${r.resource}` };
  if (r.kind === "not_modified") return { ok: false, why: "not_modified" };
  return { ok: false, why: `gh ${r.status ?? "-"} ${r.message}` };
}

/**
 * Reads one verify. `run` is the Orca Run holding an orca_field target (the snapshot knows it).
 * Unreadable is not false: the caller writes nothing for it.
 */
export async function readProbe(spec: VerifySpec, ports: ProbePorts, ctx: { run?: string; since?: string } = {}): Promise<ProbeRead> {
  switch (spec.kind) {
    case "pr_merged": {
      const [repo, n] = spec.pr.split("#");
      const r = await gh<{ merged?: boolean; merge_commit_sha?: string | null }>(ports, `repos/${spelled(ports, repo ?? "")}/pulls/${n}`);
      if (!r.ok) return { kind: "unreadable", why: r.why };
      return r.data.merged === true ? { kind: "true", observed: `${spec.pr} merged ${r.data.merge_commit_sha ?? ""}`.trim() } : { kind: "false", observed: `${spec.pr} not merged` };
    }
    case "run_ok": {
      if (!spec.run) return { kind: "unreadable", why: "no run id yet: the owner's line has not named one" };
      const r = await gh<{ status?: string; conclusion?: string | null }>(ports, `repos/${spelled(ports, spec.repo)}/actions/runs/${spec.run}`);
      if (!r.ok) return { kind: "unreadable", why: r.why };
      const c = r.data.conclusion ?? "pending";
      return c === "success" ? { kind: "true", observed: `run ${spec.run} success` } : { kind: "false", observed: `run ${spec.run} ${c}` };
    }
    case "pr_found": {
      // Only a PR opened since the item counts: an older match is not this item's effect (guards (가)·(마)).
      if (!ctx.since) return { kind: "unreadable", why: "no item time to bound the search" };
      const since = new Date(Date.parse(ctx.since)).toISOString().replace(/\.\d{3}Z$/, "Z");
      const q = encodeURIComponent(`repo:${spelled(ports, spec.repo)} is:pr created:>=${since} ${spec.search}`);
      const r = await gh<{ total_count?: number; items?: { html_url?: string }[] }>(ports, `search/issues?q=${q}&per_page=1`);
      if (!r.ok) return { kind: "unreadable", why: r.why };
      const url = r.data.items?.[0]?.html_url;
      return (r.data.total_count ?? 0) > 0 && url ? { kind: "true", observed: url } : { kind: "false", observed: `no PR for ${spec.search}` };
    }
    case "orca_field": {
      if (!ctx.run) return { kind: "unreadable", why: `no Run known for ${spec.target}` };
      if (!(ORCA_FIELDS as readonly string[]).includes(spec.field)) return { kind: "unreadable", why: `orca_field reads ${ORCA_FIELDS.join("|")}, not ${spec.field}` };
      const r = await ports.orca.taskList({ run: ctx.run, full: true });
      if (!r.ok) return { kind: "unreadable", why: `task-list ${r.error.code}` };
      const row = r.value.find((t) => t.id === spec.target) as Record<string, unknown> | undefined;
      if (!row) return { kind: "unreadable", why: `${spec.target} not in Run ${ctx.run}` };
      const got = String(row[spec.field] ?? "");
      return got === spec.value ? { kind: "true", observed: `${spec.field}=${got}` } : { kind: "false", observed: `${spec.field}=${got}` };
    }
    case "plugin_approved": {
      const r = await ports.orca.pluginList();
      if (!r.ok) return { kind: "unreadable", why: `plugin list ${r.error.code}` };
      const p = r.value.find((x) => x.pluginKey === spec.key);
      if (!p) return { kind: "false", observed: `${spec.key} not installed` };
      return p.status === "enabled" && !p.needsReconsent ? { kind: "true", observed: `${spec.key} enabled ${p.consentFingerprint}` } : { kind: "false", observed: `${spec.key} ${p.status}` };
    }
  }
}

export interface ProbeTarget {
  readonly task: string;
  readonly spec: VerifySpec;
  /** 🟢 and the owner's: a true probe also suggests closing it. */
  readonly open: boolean;
  /** When the item was created; bounds pr_found. */
  readonly since?: string;
}

/**
 * What a round reads: each owner item with a verify and no probe true yet, open or closed inside
 * verify.grace_hours. run_ok and pr_found only while the item carries a mark (decision 91②, 92 (가)).
 */
export function probeTargets(input: ViewInput, facts: readonly OwnerItemFacts[], cfg: Pick<OwnerConfig, "waitMinutes" | "graceHours"> = OWNER_DEFAULTS): ProbeTarget[] {
  const marks = ownerMarks(input, cfg);
  const graceStart = Date.parse(input.now) - cfg.graceHours * 3_600_000;
  const out: ProbeTarget[] = [];
  for (const f of facts) {
    const m: OwnerItemMarks | undefined = marks.get(f.task);
    const spec = m ? verifyWithRun(m) : null;
    if (!m || !spec || m.verified || !isOwnerItem(f) || f.state === "cancelled") continue;
    if (f.state === "done" && (!f.closedAt || Date.parse(f.closedAt) < graceStart)) continue;
    if (MARKED_ONLY.has(spec.kind) && m.mark !== "verifying" && m.mark !== "unverified") continue;
    // The hook writes the mark at the next turn, minutes after the line ran; the item's creation is guard (가)'s bound.
    out.push({ task: f.task, spec, open: f.state === "ready", ...(m.createdAt ? { since: m.createdAt } : {}) });
  }
  return out;
}

export interface RoundResult {
  readonly read: number;
  readonly passed: readonly string[];
  readonly skipped: readonly string[];
  readonly escalated: readonly string[];
}

/**
 * One probe round (the queue-monitor calls it, U17). A true probe writes evidence{probe:<kind>} on
 * the item and, while the item is open, close_suggested{verified}: the holder closes, not this
 * (decision 76 rule 6). A false or unreadable probe writes nothing. A mark that outlived
 * verify.wait_minutes is escalated once to the owning lead as escalation_stale{verify_unconfirmed}.
 */
export async function probeRound(
  ports: ProbePorts,
  store: Pick<Store, "append">,
  input: ViewInput,
  facts: readonly OwnerItemFacts[],
  cfg: Pick<OwnerConfig, "waitMinutes" | "graceHours"> = OWNER_DEFAULTS,
  source = "monitor:queue",
): Promise<RoundResult> {
  const runOf = new Map(input.orca.tasks.map((t) => [t.id, t.runId]));
  const lowBudget = budgetLevel(ports.budget) === "essential";
  const passed: string[] = [];
  const skipped: string[] = [];
  let read = 0;
  for (const t of probeTargets(input, facts, cfg)) {
    if (lowBudget && GH_KINDS.has(t.spec.kind)) {
      skipped.push(t.task);
      continue;
    }
    read++;
    const target = t.spec.kind === "orca_field" ? t.spec.target : t.task;
    const run = runOf.get(target);
    const r = await readProbe(t.spec, ports, { ...(run ? { run } : {}), ...(t.since ? { since: t.since } : {}) });
    if (r.kind !== "true") continue;
    store.append({
      type: "evidence",
      source,
      payload: { kind: `probe:${t.spec.kind}`, observed: r.observed },
      entity: "task",
      entity_id: t.task,
      dedupe_key: dedupeKey(EVENTS.evidence, "probe", t.task, t.spec.kind),
    });
    if (t.open) {
      store.append({
        type: "close_suggested",
        source,
        payload: { task: t.task, reason: "verified" },
        entity: "task",
        entity_id: t.task,
        dedupe_key: dedupeKey(EVENTS.close_suggested, t.task, "verified"),
      });
    }
    passed.push(t.task);
  }
  const escalated: string[] = [];
  const marks = ownerMarks(input, cfg);
  for (const f of facts) {
    const m = marks.get(f.task);
    if (m?.mark !== "unverified" || passed.includes(f.task) || !isOpenState(f.state)) continue;
    const r = store.append({
      type: "escalation_stale",
      source,
      payload: { ref: f.task, reason: "verify_unconfirmed" },
      entity: "task",
      entity_id: f.task,
      dedupe_key: dedupeKey(EVENTS.escalation_stale, f.task, "verify_unconfirmed", String(m.markedSeq)),
    });
    if (r.inserted) escalated.push(f.task);
  }
  return { read, passed, skipped, escalated };
}
