import type { StoredEvent } from "../contract/index.ts";
import type { GhClient } from "../gh/client.ts";
import { type MergeCondition, readMergeConditions } from "../gh/merge-conditions.ts";
import type { NewEvent } from "../store/store.ts";
import { evidenceGaps } from "../verify/evidence.ts";
import { requiredEvidence, type Tier, type TierConfig, verifyTier } from "../verify/verify-tier.ts";
import { approvedAndGreen, patchId, type Read, readDiff, readLabels, readPull } from "./github.ts";

// The land judgment (decisions 72, 79, 81, 85; appendix #role-cards): one function for the dry
// run, the real run and every entrance (R-03). Every refusal after the PR is named is a
// land_failed row with the reason the refusal carries.

export type LandInput = { repo: string; pr: number; headSha?: string; dryRun?: boolean; mainFix?: boolean };
export type LandAction = "auto_merge" | "merge_approved" | "merge_on_approval";
export type LandValue = {
  pr: string;
  head_sha: string;
  tier: Tier;
  action: LandAction;
  dry_run: boolean;
  conditions: MergeCondition[];
  note: string;
};
export type LandRefusal = { code: string; reason: string; fix: string };
export type LandOutcome = { ok: true; value: LandValue } | { ok: false; refusal: LandRefusal };

export type LandStore = {
  events(): StoredEvent[];
  append(e: NewEvent<"land_failed"> | NewEvent<"land_requested">): unknown;
  close(): void;
};
/** `tier` null and `protectedPaths` null mean that setting could not be read. */
export type LandConfig = { tier: TierConfig | null; protectedPaths: readonly string[] | null };
/** Asks GitHub to merge once its requirements hold (`gh pr merge --auto`), pinned to `head`. */
export type MergePort = (a: { repo: string; pr: number; head: string }) => Promise<{ ok: boolean; message: string }>;
export type LandDeps = { gh: GhClient; openStore: () => LandStore; merge: MergePort; config: () => LandConfig };

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const short = (sha: string) => sha.slice(0, 7);

class Refused extends Error {
  readonly code: string;
  readonly why: string;
  readonly fix: string;
  /** What land_failed.reason carries: the code, or code:detail. */
  readonly token: string;
  constructor(code: string, detail: string, why: string, fix: string) {
    super(why);
    this.code = code;
    this.why = why;
    this.fix = fix;
    this.token = detail ? `${code}:${detail}` : code;
  }
}

function stopIfLimited(r: { kind: string; resetAt?: number }): void {
  if (r.kind === "rate_limited") throw new Refused("rate_limited", "", `GitHub's rate limit resets at epoch ${r.resetAt}`, "call land again after the reset");
}

function must<T>(r: Read<T>, code: string, fix: string): T {
  stopIfLimited(r);
  if (r.kind === "ok") return r.data;
  throw new Refused(code, "", r.kind === "unreadable" ? r.why : code, fix);
}

export async function land(input: LandInput, deps: LandDeps): Promise<LandOutcome> {
  const bad = (reason: string): LandOutcome => ({ ok: false, refusal: { code: "invalid_input", reason, fix: "sangsoe land --pr <N> [--repo <owner/name>] [--head <sha>] [--dry-run] [--main-fix]" } });
  if (!REPO.test(input.repo)) return bad(`repo must be owner/name, got ${input.repo}`);
  if (!Number.isInteger(input.pr) || input.pr < 1) return bad(`pr must be a PR number, got ${input.pr}`);
  if (input.headSha !== undefined && !FULL_SHA.test(input.headSha)) return bad(`head must be a full 40-character sha, got ${input.headSha}`);

  let store: LandStore;
  try {
    store = deps.openStore();
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { ok: false, refusal: { code: "store_unavailable", reason: `cannot open the store: ${why}`, fix: "run sangsoe doctor" } };
  }
  const repo = input.repo.toLowerCase();
  const pr = `${repo}#${input.pr}`;
  let head: string | undefined;
  try {
    const value = await judge({ ...input, repo }, pr, deps, store.events(), (sha) => {
      head = sha;
    });
    if (!input.dryRun) {
      if (value.action !== "merge_on_approval") {
        const merged = await deps.merge({ repo, pr: input.pr, head: value.head_sha });
        if (!merged.ok) throw new Refused("merge_refused", "", `GitHub refused the merge: ${merged.message}`, "read the PR's merge box; land again once it is fixed");
      }
      const reason = value.action === "auto_merge" ? undefined : value.action === "merge_approved" ? "approved" : "merge_on_approval";
      store.append({ type: "land_requested", source: "land", payload: { pr, head_sha: value.head_sha, ...(reason ? { reason } : {}) } });
    }
    return { ok: true, value };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    if (!input.dryRun) store.append({ type: "land_failed", source: "land", needs: "action", payload: { pr, ...(head ? { head_sha: head } : {}), reason: e.token } });
    return { ok: false, refusal: { code: e.code, reason: `${e.token} — ${e.why}`, fix: e.fix } };
  } finally {
    store.close();
  }
}

async function judge(input: LandInput, pr: string, deps: LandDeps, events: readonly StoredEvent[], sawHead: (sha: string) => void): Promise<LandValue> {
  const { gh } = deps;
  const { repo } = input;
  const pull = must(await readPull(gh, repo, input.pr), "pr_unreadable", `check that ${pr} exists and gh is logged in`);
  const head = pull.head.sha;
  sawHead(head);
  if (pull.state !== "open" || pull.draft) {
    const state = pull.merged ? "merged" : pull.draft ? "draft" : pull.state;
    throw new Refused("pr_not_open", state, `${pr} is ${state}`, pull.draft ? "mark the PR ready for review, then land" : "nothing to land");
  }
  if (input.headSha && input.headSha !== head) {
    throw new Refused("head_moved", "", `${pr}'s head is ${short(head)}, not ${short(input.headSha)}`, `review and verify ${short(head)}, then land with --head ${head}`);
  }

  const main = events.filter((e) => (e.type === "main_red" || e.type === "main_green") && e.payload.repo === repo).at(-1);
  if (main?.type === "main_red" && !input.mainFix) {
    throw new Refused("main_red", "", `${repo}'s main is red at ${short(String(main.payload.sha))} (run ${String(main.payload.run_id)})`, "fix main first; only a PR landed with --main-fix passes");
  }

  const bottom = unmergedBelow(pr, events);
  if (bottom?.kind === "pr") {
    throw new Refused("stack_order", bottom.id, `${pr} is stacked on ${bottom.id}, which has not merged`, `land ${bottom.id} first; ${pr} opens once it merges`);
  }
  if (bottom?.kind === "unmapped") {
    throw new Refused(
      "stack_order",
      bottom.id,
      `${pr} has no pr_opened with a task, and a stacked_on edge ends at task ${bottom.id}, which no PR is mapped to; it may be this PR`,
      `record pr_opened{pr: ${pr}, task} for this PR, or the PR of task ${bottom.id}, then call land again`,
    );
  }
  if (bottom?.kind === "task") {
    throw new Refused(
      "stack_order",
      bottom.id,
      `${pr} is stacked on task ${bottom.id}, which has no pr_opened, so its PR cannot be checked`,
      `open and land the PR of task ${bottom.id} first, or remove the stacked_on edge`,
    );
  }

  const note: string[] = [];
  note.push(await reviewed(gh, { repo, pr, head, base: pull.base.ref, events }));

  const diff = await readDiff(gh, repo, input.pr);
  const labels = await readLabels(gh, repo, input.pr, pull);
  stopIfLimited(diff);
  stopIfLimited(labels);
  const config = deps.config();
  const tier = verifyTier(diff.kind === "ok" ? diff.data : null, labels.kind === "ok" ? labels.data : null, config.tier);
  const kinds = requiredEvidence(tier);
  const gaps = evidenceGaps(events, { pr, head, author: pull.user.login, kinds });
  const gap = gaps[0];
  if (gap) {
    throw new Refused(
      "evidence_missing",
      gap.kind,
      `${tier.effective} (${tier.reason}) needs ${kinds.join(", ")} at ${short(head)}; ${gaps.map((g) => `${g.kind}: ${g.why}`).join("; ")}`,
      `record evidence{kind, head_sha: ${head}, exit_code: 0, not_verified} with subject ${pr} for ${gaps.map((g) => g.kind).join(", ")}; the PR's author cannot write it`,
    );
  }
  note.push(`${tier.effective}: ${kinds.length ? kinds.join(", ") : "required CI only"}`);

  const read = await readMergeConditions(gh, { repo, base: pull.base.ref, pr: input.pr, protectedPaths: config.protectedPaths });
  stopIfLimited(read);
  const conditions = read.kind === "read" ? read.conditions : [];
  const base = { pr, head_sha: head, tier: tier.effective, dry_run: input.dryRun === true, conditions };
  if (read.kind === "read" && read.autoMerge) return { ...base, action: "auto_merge", note: [...note, "all four conditions hold"].join("; ") };
  const approved = must(await approvedAndGreen(gh, repo, input.pr, pull, config.tier?.owners ?? []), "pr_unreadable", "call land again");
  if (approved) return { ...base, action: "merge_approved", note: [...note, "approved and green at the head"].join("; ") };
  return { ...base, action: "merge_on_approval", note: [...note, "merge once approved; the lead calls land again"].join("; ") };
}

type StackNode = { kind: "pr" | "task" | "unmapped"; id: string };

/**
 * The lowest unmerged PR this one is stacked on. Edges join Orca Task ids (glossary 부가 간선),
 * so PRs and tasks are joined through `pr_opened{pr, task}`; a predecessor task with no PR is
 * returned as itself, because an unknown PR cannot be shown merged.
 */
function unmergedBelow(pr: string, events: readonly StoredEvent[]): StackNode | null {
  const edges = new Map<string, boolean>();
  const tasksOf = new Map<string, Set<string>>();
  const prOf = new Map<string, string>();
  for (const e of events) {
    if (e.type === "pr_opened" && typeof e.payload.task === "string") {
      const ref = String(e.payload.pr).toLowerCase();
      prOf.set(e.payload.task, ref);
      tasksOf.set(ref, (tasksOf.get(ref) ?? new Set()).add(e.payload.task));
    }
    if ((e.type !== "edge_added" && e.type !== "edge_removed") || e.payload.kind !== "stacked_on") continue;
    edges.set(`${String(e.payload.pred)}\n${String(e.payload.succ)}`, e.type === "edge_added");
  }
  const merged = new Set(events.filter((e) => e.type === "pr_merged").map((e) => String(e.payload.pr).toLowerCase()));
  const preds = (ref: string): StackNode[] => {
    const succs = new Set([ref, ...(tasksOf.get(ref) ?? [])]);
    return [...edges.entries()]
      .filter(([k, live]) => live && succs.has(k.slice(k.indexOf("\n") + 1)))
      .map(([k]) => {
        const p = k.slice(0, k.indexOf("\n"));
        const mapped = PR_REF.test(p.toLowerCase()) ? p.toLowerCase() : prOf.get(p);
        return mapped ? { kind: "pr", id: mapped } : { kind: "task", id: p };
      });
  };
  if (!tasksOf.has(pr)) {
    // Without this PR's task the edges ending at it cannot be found, so any edge whose
    // successor task has no PR might be this one.
    for (const [k, live] of edges) {
      const succ = k.slice(k.indexOf("\n") + 1);
      if (live && !PR_REF.test(succ.toLowerCase()) && !prOf.has(succ)) return { kind: "unmapped", id: succ };
    }
  }
  const seen = new Set<string>();
  const walk = (ref: string): StackNode | null => {
    for (const p of preds(ref)) {
      if (p.kind === "task") return p;
      if (merged.has(p.id) || seen.has(p.id)) continue;
      seen.add(p.id);
      return walk(p.id) ?? p;
    }
    return null;
  };
  return walk(pr);
}

const PR_REF = /^[a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9][0-9]*$/;

async function reviewed(gh: GhClient, a: { repo: string; pr: string; head: string; base: string; events: readonly StoredEvent[] }): Promise<string> {
  const verdicts = a.events.filter((e) => e.type === "review_verdict" && e.payload.pr === a.pr);
  const atHead = verdicts.filter((e) => e.payload.head_sha === a.head);
  const actOn = atHead.find((e) => Number(e.payload.act_on) > 0);
  if (actOn) {
    throw new Refused("review_act_on", String(actOn.payload.act_on), `${String(actOn.payload.reviewer)} left Act-on findings at ${short(a.head)}`, "fix them, push, and have the new head reviewed");
  }
  if (atHead.length > 0) return `reviewed by ${atHead.map((e) => String(e.payload.reviewer)).join(", ")}`;

  const older = [...new Set(verdicts.map((e) => String(e.payload.head_sha)))].filter(
    (sha) => !verdicts.some((e) => e.payload.head_sha === sha && Number(e.payload.act_on) > 0),
  );
  const reviewHead = `review the head ${short(a.head)} and record the verdict with sangsoe review record`;
  if (older.length === 0) throw new Refused("review_missing", "", `no review verdict for ${a.pr}`, reviewHead);

  // Patch-id inheritance: a clean verdict on an older head carries over only when that head's own
  // change equals the current one, compared against the current base and every base it had.
  const bases = [a.base, ...a.events.filter((e) => e.type === "pr_base_changed" && e.payload.pr === a.pr).map((e) => String(e.payload.from))];
  const now = await patchId(gh, a.repo, a.base, a.head);
  for (const sha of older) {
    for (const base of new Set(bases)) {
      if (now !== null && (await patchId(gh, a.repo, base, sha)) === now) return `verdict inherited from ${short(sha)} by patch-id`;
    }
  }
  const last = older.at(-1) as string;
  throw new Refused("review_stale", short(last), `the verdict is for ${short(last)}, the head is ${short(a.head)} and the patch-ids differ`, reviewHead);
}
