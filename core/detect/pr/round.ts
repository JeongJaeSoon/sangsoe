import type { StoredEvent } from "../../contract/index.ts";
import { canTransition } from "../../contract/transitions.ts";
import { budgetLevel, type GhResponse } from "../../gh/client.ts";
import { approvedAndGreen, mergeConfirm, type Pull, readDiff, readLabels, readPull } from "../../land/github.ts";
import { hostRereadPending } from "../../store/backup.ts";
import { verifyTier } from "../../verify/verify-tier.ts";
import type { Act, MonitorDeps, Planned, Reading } from "../monitor.ts";
import { sendNotice } from "../notice.ts";
import type { WatchConfig } from "./config.ts";
import { classifyMain, isClosedTask, itemStateOf, key, type MainRun, prRef, prUrl, requestedTier } from "./judge.ts";
import { type IssueEvent, PAGE, type Review, type ReviewComment, type ReviewReads, reviewFacts } from "./reviews.ts";

const SOURCE = "pr-monitor";
const CLOSED_PAGE = 30;

type ListedPull = {
  number: number;
  merged_at?: string | null;
  user: { login: string } | null;
  head: { sha: string; ref: string; repo?: { full_name?: string } | null };
  base: { ref: string };
  labels?: { name: string }[];
};

/** A Task Orca links to the PR: a local workspace whose agent's mailbox is a Dispatch. */
export type LinkedTask = { task: string; run: string; dispatch: string; live: boolean };
type Link = { linked: boolean; tasks: LinkedTask[] };

class RateLimited extends Error {
  readonly resetAt: number;
  constructor(resetAt: number) {
    super("rate limited");
    this.resetAt = resetAt;
  }
}

type Reads = {
  d: MonitorDeps;
  watch: WatchConfig;
  /** Every pr-monitor fact already in the store, by type. */
  rows: Map<string, StoredEvent[]>;
  planned: Planned[];
  unseen: string[];
  acts: Act[];
  /**
   * Review lists are read against the last ETag. Not while a lost database waits for its reread:
   * the ETags outlive the rows they were judged into (decision 195).
   */
  conditional: boolean;
  /** `notified` dedupe keys, read once per round when a review wake is weighed. */
  notified?: string[];
};

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const plan = (r: Reads, e: Omit<Planned, "source">) => r.planned.push({ source: SOURCE, ...e } as Planned);
const rowsOf = (r: Reads, type: string, pr: string) => (r.rows.get(type) ?? []).filter((e) => e.payload.pr === pr);

async function get<T>(r: Reads, path: string): Promise<T | null> {
  const res = (await r.d.gh?.get<T>(path)) as GhResponse<T> | undefined;
  if (!res) return null;
  if (res.kind === "rate_limited") throw new RateLimited(res.resetAt);
  if (res.kind !== "ok" || res.data === null) {
    r.unseen.push(`gh ${path}`);
    return null;
  }
  return res.data;
}

/** A conditional read: `unchanged` on a 304, so a list already judged is not judged again. */
async function changed<T>(r: Reads, path: string): Promise<T | "unchanged" | null> {
  const res = (await r.d.gh?.get<T>(path, { conditional: r.conditional })) as GhResponse<T> | undefined;
  if (res?.kind === "not_modified") return "unchanged";
  if (res?.kind === "rate_limited") throw new RateLimited(res.resetAt);
  if (res?.kind !== "ok" || res.data === null) {
    r.unseen.push(`gh ${path}`);
    return null;
  }
  return res.data;
}

const WORKER_PAGES = 3;

/** Dispatches by workspace id, from `worker-list` (newest first): a released worker leaves no agent row. */
export async function dispatchesByWorkspace(d: MonitorDeps): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  let cursor: string | undefined;
  for (let page = 0; page < WORKER_PAGES; page++) {
    const r = await d.orca.workerList({ limit: 100, ...(cursor ? { cursor } : {}) });
    if (!r.ok) break;
    for (const w of r.value.rows) if (w.workspace) out.set(w.workspace, [...(out.get(w.workspace) ?? []), w.dispatchId]);
    cursor = r.value.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/**
 * Orca's `reference find <url>` is the link (decision 80 N7). A live agent's mailbox names its
 * Dispatch; once the worker is released the workspace's Dispatches come from `worker-list`.
 */
export async function linkOf(d: MonitorDeps, url: string, workers: () => Promise<Map<string, string[]>>): Promise<Link | null> {
  const found = await d.orca.referenceFind({ query: url, limit: 20 });
  if (!found.ok) return null;
  const matches = Array.isArray(found.value.matches) ? (found.value.matches as Record<string, unknown>[]) : [];
  const local = matches.filter((m) => {
    const ws = (m.workspace ?? {}) as Record<string, unknown>;
    return (ws.hostId === undefined || ws.hostId === "local") && ws.archived !== true;
  });
  const dispatches = new Set<string>();
  for (const m of local) {
    const before = dispatches.size;
    for (const a of Array.isArray(m.agents) ? (m.agents as Record<string, unknown>[]) : []) {
      const mail = /^dispatch:(.+)$/.exec(str(a.mailbox) ?? "");
      if (mail?.[1]) dispatches.add(mail[1]);
    }
    const ws = str((m.workspace as Record<string, unknown> | undefined)?.id);
    if (dispatches.size === before && ws) for (const id of (await workers()).get(ws) ?? []) dispatches.add(id);
  }
  const tasks = new Map<string, LinkedTask>();
  for (const dispatch of dispatches) {
    const show = await d.orca.workerShow({ dispatch });
    if (show.ok && show.value.taskId && show.value.runId) {
      const live = show.value.liveness === "live";
      // A Task's live Dispatch wins over its ended ones, whatever order Orca listed them in.
      if (!tasks.get(show.value.taskId)?.live) tasks.set(show.value.taskId, { task: show.value.taskId, run: show.value.runId, dispatch, live });
    }
  }
  return { linked: local.length > 0, tasks: [...tasks.values()] };
}

/**
 * The PR item's Task: the first `pr_opened` that recorded one (a later link, such as another
 * workspace that printed the URL, never takes it over), else the one Task Orca links.
 */
function itemTask(r: Reads, ref: string, link: Link | null): string | undefined {
  const recorded = rowsOf(r, "pr_opened", ref)
    .map((e) => str(e.payload.task))
    .find((t) => t !== undefined);
  if (recorded) return recorded;
  return link?.tasks.length === 1 ? link.tasks[0]?.task : undefined;
}

async function taskStatus(d: MonitorDeps, t: LinkedTask): Promise<string | null> {
  const l = await d.orca.taskList({ run: t.run });
  return l.ok ? (l.value.find((x) => x.id === t.task)?.status ?? null) : null;
}

/** Decision 84 ①: the one close a detector makes, after the merge is confirmed. */
function closeTask(ref: string, sha: string, task: string, linked: LinkedTask | undefined): Act {
  return {
    what: `task-update ${task} completed (${ref} merged)`,
    run: async (d) => {
      let from = null;
      if (linked) {
        const status = await taskStatus(d, linked);
        if (status && isClosedTask(status)) return { ok: true, detail: `already ${status}`, planned: [] };
        from = status ? itemStateOf(status) : null;
      }
      const u = await d.orca.taskUpdate({ id: task, status: "completed", result: `merged ${ref} as ${sha}`, ...(linked ? { run: linked.run } : {}) });
      if (!u.ok) return { ok: false, detail: `${u.error.code}: ${u.error.message}`, planned: [] };
      const planned: Planned[] =
        from && canTransition(from, "done")
          ? [{ type: "item_transition", source: SOURCE, dedupe_key: key("item_transition", task, "done"), payload: { task, from, to: "done", reason: `pr_merged ${ref}` } }]
          : [];
      return { ok: true, detail: from ? `${from} → done` : "closed; prior state unread", planned };
    },
  };
}

async function onMerged(r: Reads, repo: string, p: ListedPull, link: Link | null): Promise<void> {
  const ref = prRef(repo, p.number);
  const merged = rowsOf(r, "pr_merged", ref).length > 0;
  const task = itemTask(r, ref, link);
  const linked = link?.tasks.find((t) => t.task === task);
  if (merged) {
    // A close that failed last round is tried again while the PR is among the recent merges.
    const done = (r.rows.get("item_transition") ?? []).some((e) => e.payload.task === task && e.payload.to === "done");
    const sha = str(rowsOf(r, "pr_merged", ref).at(-1)?.payload.merge_sha);
    if (task && linked && sha && !done) {
      const status = await taskStatus(r.d, linked);
      if (status && !isClosedTask(status)) r.acts.push(closeTask(ref, sha, task, linked));
    }
    return;
  }
  const confirm = await mergeConfirm(r.d.gh as NonNullable<MonitorDeps["gh"]>, repo, p.number);
  if (!confirm.merged || !confirm.merge_sha) {
    r.unseen.push(`merge of ${ref}: ${confirm.reason}`);
    return;
  }
  const full = await get<{ merged_by?: { login: string } | null }>(r, `repos/${repo}/pulls/${p.number}`);
  const by = full?.merged_by?.login?.toLowerCase();
  const landed = rowsOf(r, "land_requested", ref).length > 0;
  const ownerMerge = by !== undefined && !landed && r.watch.owners.includes(by);
  plan(r, {
    type: "pr_merged",
    dedupe_key: key("pr_merged", ref),
    ...(by ? { actor: ownerMerge ? `owner:${by}` : by } : {}),
    payload: { pr: ref, merge_sha: confirm.merge_sha, ...(p.merged_at ? { merged_at: p.merged_at } : {}) },
  });
  if (task) r.acts.push(closeTask(ref, confirm.merge_sha, task, linked));
  else r.unseen.push(`item Task of ${ref}`);
  // §9 X4: the other Tasks the PR touched get a suggestion, only while Orca keeps them open.
  for (const other of link?.tasks.filter((t) => t.task !== task) ?? []) {
    const status = await taskStatus(r.d, other);
    if (status === null) r.unseen.push(`status of ${other.task}`);
    else if (!isClosedTask(status)) {
      plan(r, {
        type: "close_suggested",
        dedupe_key: key("close_suggested", other.task, ref),
        payload: { task: other.task, reason: `${ref} merged; Orca keeps this Task open` },
      });
    }
  }
  // Decision 92 (나): only the GitHub side — an owner's merge no item or land request explains.
  if (ownerMerge && !task && link !== null && !link.linked) {
    plan(r, { type: "owner_act_unlinked", dedupe_key: key("owner_act_unlinked", ref, "merged"), actor: `owner:${by}`, payload: { act: `merged ${ref}` } });
  }
}

async function onOpen(r: Reads, repo: string, p: ListedPull, link: Link | null, level: string): Promise<void> {
  const ref = prRef(repo, p.number);
  const opened = rowsOf(r, "pr_opened", ref);
  const task = link?.tasks.length === 1 ? link.tasks[0]?.task : undefined;
  if (opened.length === 0 || (task && !opened.some((e) => e.payload.task !== undefined))) {
    plan(r, {
      type: "pr_opened",
      dedupe_key: task ? key("pr_opened", ref, task) : key("pr_opened", ref),
      payload: { pr: ref, ...(task ? { task } : {}), base: p.base.ref, head_sha: p.head.sha },
    });
  }
  if (link && !link.linked) await addReference(r, repo, p);

  const bases = [...opened.map((e) => str(e.payload.base)), ...rowsOf(r, "pr_base_changed", ref).map((e) => str(e.payload.to))].filter((b) => b !== undefined);
  const lastBase = bases.at(-1);
  if (lastBase && lastBase !== p.base.ref) {
    plan(r, {
      type: "pr_base_changed",
      dedupe_key: key("pr_base_changed", ref, lastBase, p.base.ref, p.head.sha),
      payload: { pr: ref, from: lastBase, to: p.base.ref },
    });
  }

  if (level === "normal") await tier(r, repo, p);
  await readyToMerge(r, repo, p, link);
  await reviews(r, repo, p);
  reviewWake(r, ref, link);
}

/** The review events that wake, with the one-letter mark that keeps review and comment ids apart in a key. */
const WAKE_TYPES: Readonly<Record<string, { mark: string; label: string }>> = {
  pr_changes_requested: { mark: "r", label: "변경 요청(review id)" },
  review_commented: { mark: "c", label: "리뷰 코멘트(review comment id)" },
};

/**
 * Decision 201: reviews that ask for action wake the PR's worker with one message per round naming
 * the GitHub ids not sent before: the Task's live Dispatch, else its lead's Run. The notify key lists
 * the ids, so each id goes out once. Read from the rows, not from this round's writes, so a wake that
 * could not be sent (link unread, send failed) goes out on a later round. Ids only, no text.
 */
function reviewWake(r: Reads, ref: string, link: Link | null): void {
  const rows = Object.keys(WAKE_TYPES).flatMap((type) => [
    ...rowsOf(r, type, ref),
    ...r.planned.filter((e) => e.type === type && (e.payload as { pr?: unknown }).pr === ref),
  ]);
  if (rows.length === 0) return;
  const task = itemTask(r, ref, link);
  const linked = link?.tasks.find((t) => t.task === task);
  if (!task || !linked) return void r.unseen.push(`review wake of ${ref}: no linked Task`);
  const prefix = `${key("notify", task, "review")}:`;
  const told = new Set(
    (r.notified ??= r.d.events({ type: "notified" }).map((e) => e.dedupe_key ?? ""))
      .filter((k) => k.startsWith(prefix))
      .flatMap((k) => k.slice(prefix.length).split(":")),
  );
  const fresh = new Map<string, string[]>();
  for (const e of rows) {
    const w = WAKE_TYPES[e.type];
    const id = (e.dedupe_key ?? "").split(":").at(-1) ?? "";
    if (!w || !/^\d+$/.test(id) || told.has(`${w.mark}${id}`)) continue;
    told.add(`${w.mark}${id}`);
    fresh.set(w.label, [...(fresh.get(w.label) ?? []), id]);
  }
  if (fresh.size === 0) return;
  const marks = Object.values(WAKE_TYPES).flatMap((w) => (fresh.get(w.label) ?? []).map((id) => `${w.mark}${id}`));
  const ids = [...fresh].map(([label, list]) => `${label} ${list.join(", ")}`).join(" · ");
  const address = linked.live ? `dispatch:${linked.dispatch}` : `run:${linked.run}`;
  r.acts.push({
    what: `notify ${address} ${ref} reviews ${marks.join(" ")}`,
    wake: true,
    run: async (d) => ({
      ...(await sendNotice(d, {
        key: { target: task, dedupe_key: key("notify", task, "review", ...marks) },
        to: linked.live ? "worker" : "lead",
        chain: linked.live ? { dispatch: linked.dispatch, leadRun: linked.run } : { leadRun: linked.run },
        subject: `🔁 리뷰: ${ref}`,
        body: `${ref} 에 대응할 리뷰가 왔다: ${ids}. GitHub 에서 읽고 대응한다.`,
        msgType: "status",
        source: SOURCE,
      })),
      planned: [],
    }),
  });
}

/** Decision 195: review requests, changes requested, comments and the author's replies, by GitHub id. */
async function reviews(r: Reads, repo: string, p: ListedPull): Promise<void> {
  const ref = prRef(repo, p.number);
  const at = `repos/${repo}`;
  const known = new Set(REVIEW_TYPES.flatMap((t) => rowsOf(r, t, ref).map((e) => e.dedupe_key)));
  const none: ReviewReads = { requests: null, reviews: null, comments: null };
  // Each list is planned as soon as it is read: its ETag is saved now, and a rate limit on the next
  // list ends the round with only what is already planned.
  const judge = (reads: ReviewReads) => {
    const { facts, full } = reviewFacts(ref, p.user?.login.toLowerCase() ?? "", reads);
    for (const f of facts) if (!known.has(f.dedupe_key ?? null)) plan(r, f);
    for (const k of full) r.unseen.push(`${ref}: ${k} past the first ${PAGE}`);
  };
  judge({ ...none, requests: await changed<IssueEvent[]>(r, `${at}/issues/${p.number}/events?per_page=${PAGE}`) });
  judge({ ...none, reviews: await changed<Review[]>(r, `${at}/pulls/${p.number}/reviews?per_page=${PAGE}`) });
  // Newest first, so a long thread's page always holds the new comments.
  judge({ ...none, comments: await changed<ReviewComment[]>(r, `${at}/pulls/${p.number}/comments?sort=created&direction=desc&per_page=${PAGE}`) });
}

/** A PR whose branch is a local workspace Orca did not link yet: attach it there (decision 64, one-way). */
async function addReference(r: Reads, repo: string, p: ListedPull): Promise<void> {
  const list = await r.d.orca.worktreeList({ limit: 500 });
  if (!list.ok) {
    r.unseen.push("worktree list");
    return;
  }
  const ws = onBranchRows(list.value.rows, repo, p);
  if (ws.length !== 1 || !ws[0]) return;
  const worktree = `id:${ws[0].id}`;
  const url = prUrl(repo, p.number);
  r.acts.push({
    what: `reference add ${url} to ${ws[0].displayName}`,
    run: async (d) => {
      const a = await d.orca.referenceAdd({ worktree, urls: [url] });
      return a.ok ? { ok: true, detail: "added", planned: [] } : { ok: false, detail: `${a.error.code}: ${a.error.message}`, planned: [] };
    },
  });
}

/** Decision 85: label or new push → `verify_tier_set`, pr-monitor its only writer. */
async function tier(r: Reads, repo: string, p: ListedPull): Promise<void> {
  const ref = prRef(repo, p.number);
  const names = (p.labels ?? []).map((l) => l.name);
  const requested = requestedTier(names);
  const last = rowsOf(r, "verify_tier_set", ref).at(-1);
  if (last && last.payload.head_sha === p.head.sha && (str(last.payload.requested) ?? null) === requested) return;
  const gh = r.d.gh as NonNullable<MonitorDeps["gh"]>;
  const pull = { head: { sha: p.head.sha }, base: p.base, user: p.user ?? { login: "" }, state: "open", labels: p.labels ?? [] } as Pull;
  const diff = await readDiff(gh, repo, p.number);
  if (diff.kind === "rate_limited") throw new RateLimited(diff.resetAt);
  const labels = await readLabels(gh, repo, p.number, pull);
  if (labels.kind === "rate_limited") throw new RateLimited(labels.resetAt);
  const v = verifyTier(diff.kind === "ok" ? diff.data : null, labels.kind === "ok" ? labels.data : null, r.d.tier?.() ?? null);
  const label = labels.kind === "ok" ? labels.data.find((l) => requestedTier([l.name]) === v.requested) : undefined;
  plan(r, {
    type: "verify_tier_set",
    dedupe_key: key("verify_tier_set", ref, p.head.sha, requested ?? "none"),
    payload: {
      pr: ref,
      head_sha: p.head.sha,
      computed: v.computed,
      ...(v.requested ? { requested: v.requested } : {}),
      effective: v.effective,
      actor: (v.requested && label?.actor) || SOURCE,
      accepted: v.accepted,
      reason: v.reason,
    },
  });
}

/** Decision 81: a `merge_on_approval` PR approved and green at its head wakes its owning lead once. */
async function readyToMerge(r: Reads, repo: string, p: ListedPull, link: Link | null): Promise<void> {
  const ref = prRef(repo, p.number);
  const land = rowsOf(r, "land_requested", ref).at(-1);
  if (land?.payload.reason !== "merge_on_approval") return;
  if (rowsOf(r, "pr_ready_to_merge", ref).some((e) => e.dedupe_key === key("pr_ready_to_merge", ref, p.head.sha))) return;
  const gh = r.d.gh as NonNullable<MonitorDeps["gh"]>;
  const pull = await readPull(gh, repo, p.number);
  if (pull.kind === "rate_limited") throw new RateLimited(pull.resetAt);
  if (pull.kind !== "ok") return void r.unseen.push(`${ref}: ${pull.why}`);
  const green = await approvedAndGreen(gh, repo, p.number, pull.data, r.watch.owners);
  if (green.kind === "rate_limited") throw new RateLimited(green.resetAt);
  if (green.kind !== "ok") return void r.unseen.push(`${ref}: ${green.why}`);
  if (!green.data) return;
  plan(r, { type: "pr_ready_to_merge", dedupe_key: key("pr_ready_to_merge", ref, p.head.sha), payload: { pr: ref } });
  const task = itemTask(r, ref, link);
  const lead = link?.tasks.find((t) => t.task === task)?.run;
  if (!task || !lead) return void r.unseen.push(`owning lead of ${ref}`);
  r.acts.push({
    what: `notify run:${lead} ${ref} ready to merge`,
    wake: true,
    run: async (d) => {
      const n = await sendNotice(d, {
        key: { target: task, dedupe_key: key("notify", task, "ready_to_merge", p.head.sha) },
        to: "lead",
        // No dispatch in the chain: the author already ended with merge_ready, the lead lands it.
        chain: { leadRun: lead },
        subject: `🟢 머지 가능: ${ref}`,
        body: `${ref} 가 승인과 필수 검사를 채웠다(head ${p.head.sha.slice(0, 7)}). sangsoe land 를 다시 불러 머지한다.`,
        msgType: "status",
        source: SOURCE,
      });
      return { ...n, planned: [] };
    },
  });
}

/**
 * Decision 79 N2: the push CI of the repository's newest merge sha. land reads the last main_* row
 * per repository, so an older sha judged after a newer one would overwrite the newer state.
 */
async function mainCi(r: Reads): Promise<void> {
  const now = r.d.now();
  const since = now - r.d.config.mainWatchHours * 3_600_000;
  const seen = (t: string) => new Set((r.rows.get(t) ?? []).map((e) => `${e.payload.repo}@${e.payload.sha}`));
  // A red sha is read again: a rerun that passes after the grace turns it green.
  const green = seen("main_green");
  const red = seen("main_red");
  const failed = new Set((r.rows.get("ci_failed") ?? []).map((e) => e.dedupe_key));
  // Newest by GitHub's merge time, not store order: a merge first seen late must not count as newest.
  const at = (m: StoredEvent) => str(m.payload.merged_at) ?? m.ts;
  const newest = new Map<string, StoredEvent>();
  for (const m of r.rows.get("pr_merged") ?? []) {
    const repo = (str(m.payload.pr) ?? "").split("#")[0] ?? "";
    const prev = newest.get(repo);
    if (!prev || Date.parse(at(m)) >= Date.parse(at(prev))) newest.set(repo, m);
  }
  for (const m of newest.values()) {
    const ref = str(m.payload.pr) ?? "";
    const repo = ref.split("#")[0] ?? "";
    const sha = str(m.payload.merge_sha) ?? "";
    // The stored ref is lowercase; GitHub is asked under the spelling watch.repos gives.
    const given = r.watch.repos.find((w) => w.toLowerCase() === repo);
    if (!given || Date.parse(at(m)) < since || green.has(`${repo}@${sha}`)) continue;
    const listed = await get<{ workflow_runs?: Record<string, unknown>[] }>(r, `repos/${given}/actions/runs?head_sha=${sha}&event=push&per_page=100`);
    if (!listed || !Array.isArray(listed.workflow_runs)) continue;
    const runs: MainRun[] = [];
    for (const w of listed.workflow_runs) {
      const id = Number(w.id);
      const conclusion = str(w.conclusion) ?? null;
      let jobs: number | null = null;
      if (["failure", "timed_out", "startup_failure"].includes(conclusion ?? "")) {
        const j = await get<{ total_count?: number }>(r, `repos/${given}/actions/runs/${id}/jobs?per_page=1`);
        jobs = typeof j?.total_count === "number" ? j.total_count : null;
      }
      runs.push({ id, run_attempt: Number(w.run_attempt ?? 1), status: str(w.status) ?? "", conclusion, updatedAt: Date.parse(str(w.updated_at) ?? "") || now, jobs });
    }
    const v = classifyMain(runs, now, r.d.config.mainRerunMinutes * 60_000);
    if (v.kind === "unknown") r.unseen.push(`main CI of ${repo}@${sha.slice(0, 7)}: ${v.why}`);
    if (v.kind === "green" || (v.kind === "red" && !red.has(`${repo}@${sha}`))) {
      const type = v.kind === "green" ? "main_green" : "main_red";
      plan(r, { type, dedupe_key: key(type, repo, sha), payload: { repo, sha, run_id: String(v.run.id) } });
    }
    if (v.kind === "suspect") {
      const k = key("ci_failed", String(v.run.id), String(v.run.run_attempt));
      if (!failed.has(k)) plan(r, { type: "ci_failed", dedupe_key: k, payload: { pr: ref, head_sha: sha, run_id: String(v.run.id) } });
    }
  }
}

const REVIEW_TYPES = ["pr_review_requested", "pr_changes_requested", "review_commented", "review_replied"];
const TYPES = ["pr_opened", "pr_merged", "pr_closed", "pr_base_changed", "verify_tier_set", "land_requested", "pr_ready_to_merge", "main_green", "main_red", "ci_failed", "item_transition", ...REVIEW_TYPES];

/**
 * One pr-monitor round. GitHub through core/gh only, Orca through the adapter only; the PR's link to
 * an item is Orca's `reference find`, never a copy. Writes events, and one kind of item change: the
 * merged PR's Task goes `completed`, as an act after `pr_merged` (decision 84 ①).
 */
export async function prRound(d: MonitorDeps, signal: AbortSignal): Promise<Reading> {
  const conditional = !hostRereadPending(d.events({ type: "signal" }));
  const r: Reads = { d, watch: { repos: [], authors: [], linkedOnly: true, owners: [] }, rows: new Map(), planned: [], unseen: [], acts: [], conditional };
  if (!d.gh) return { planned: [], unseen: ["gh client"] };
  const watch = d.watch?.() ?? null;
  if (!watch || watch.repos.length === 0) return { planned: [], unseen: ["watch.repos setting"] };
  r.watch = watch;
  for (const t of TYPES) r.rows.set(t, d.events({ type: t }));
  const level = budgetLevel(d.ghBudget?.());
  let byWorkspace: Promise<Map<string, string[]>> | undefined;
  const workers = () => {
    byWorkspace ??= dispatchesByWorkspace(d);
    return byWorkspace;
  };
  try {
    for (const repo of watch.repos) {
      if (signal.aborted) break;
      const open = level === "essential" ? [] : ((await get<ListedPull[]>(r, `repos/${repo}/pulls?state=open&per_page=100`)) ?? []);
      const closed = (await get<ListedPull[]>(r, `repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${CLOSED_PAGE}`)) ?? [];
      // pr_merged rows then follow merge order, so the newest merge has the repository's last row.
      closed.sort((a, b) => (a.merged_at ?? "").localeCompare(b.merged_at ?? ""));
      for (const [p, isOpen] of [...open.map((x) => [x, true] as const), ...closed.map((x) => [x, false] as const)]) {
        if (signal.aborted) break;
        const ref = prRef(repo, p.number);
        const author = p.user?.login.toLowerCase() ?? "";
        if (watch.authors.length > 0 && !watch.authors.includes(author)) continue;
        const known = rowsOf(r, "pr_opened", ref).length > 0;
        if (!isOpen && !p.merged_at && !known) continue;
        const link = await linkOf(d, prUrl(repo, p.number), workers);
        if (!link) r.unseen.push(`reference find ${ref}`);
        // linked_only: Orca's link, a recorded pr_opened, or (open PRs) a workspace on its branch.
        if (watch.linkedOnly && !known && !link?.linked && !isOpen) continue;
        if (isOpen) {
          if (watch.linkedOnly && !known && !link?.linked && !(await onBranch(d, repo, p))) continue;
          await onOpen(r, repo, p, link, level);
        } else if (p.merged_at) {
          if (level !== "essential" && rowsOf(r, "pr_merged", ref).length === 0 && !known && link?.linked) {
            const task = link.tasks.length === 1 ? link.tasks[0]?.task : undefined;
            // Seen first already merged: the item↔PR row land and the brief read still gets written.
            plan(r, { type: "pr_opened", dedupe_key: task ? key("pr_opened", ref, task) : key("pr_opened", ref), payload: { pr: ref, ...(task ? { task } : {}), base: p.base.ref, head_sha: p.head.sha } });
          }
          await onMerged(r, repo, p, link);
        } else if (rowsOf(r, "pr_closed", ref).length === 0) {
          plan(r, { type: "pr_closed", dedupe_key: key("pr_closed", ref), payload: { pr: ref } });
        }
      }
    }
    if (!signal.aborted) await mainCi(r);
  } catch (e) {
    if (!(e instanceof RateLimited)) throw e;
    const reset = new Date(e.resetAt * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    plan(r, { type: "rate_limited", dedupe_key: key("rate_limited", "github", String(e.resetAt)), payload: { kind: "github", reset_at: reset } });
    r.unseen.push(`GitHub rate limit until ${reset}`);
  }
  return { planned: r.planned, unseen: r.unseen, acts: r.acts };
}

/**
 * Workspaces of this repository on the PR's head branch. Orca lists full refs (`refs/heads/x`) and
 * `projectId: github:<owner>/<repo>`; a row without that id matches nothing. A fork's head (a deleted
 * fork has `head.repo: null`) and a head named like the base match nothing either.
 */
export function onBranchRows<W extends { branch: string; isArchived: boolean; projectId?: string }>(rows: readonly W[], repo: string, p: ListedPull): W[] {
  const own = repo.toLowerCase();
  if (p.head.repo?.full_name?.toLowerCase() !== own || p.head.ref === p.base.ref) return [];
  return rows.filter((w) => w.projectId?.toLowerCase() === `github:${own}` && w.branch.replace(/^refs\/heads\//, "") === p.head.ref && !w.isArchived);
}

async function onBranch(d: MonitorDeps, repo: string, p: ListedPull): Promise<boolean> {
  const list = await d.orca.worktreeList({ limit: 500 });
  return list.ok && onBranchRows(list.value.rows, repo, p).length === 1;
}
