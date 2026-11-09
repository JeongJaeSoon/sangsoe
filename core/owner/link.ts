import type { StoredEvent, VerifySpec, ViewInput } from "../contract/index.ts";
import { dedupeKey, EVENTS } from "../contract/index.ts";
import { mask } from "../session/mask.ts";
import type { Appended, Store } from "../store/store.ts";
import { ownerMarks } from "./marks.ts";
import { isOwnerItem, OWNER_DEFAULTS, type OwnerConfig, type OwnerItemFacts } from "./types.ts";

/** One `!` line as the hook read it from the transcript (decision 91⑥(1)(b)); format unknown until P13. */
export interface ShellLine {
  /** The transcript line id: `owner_act:<uuid>` keeps one line to one row (guard (라)). */
  readonly uuid: string;
  readonly command: string;
  /** null when the transcript carries no exit code (P13): then only an expected URL or id links. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The repo the session works in, lowercase owner/repo, if known. */
  readonly repo: string | null;
  readonly ts: string;
}

export type ShellLink =
  | { readonly kind: "seen"; readonly task: string; readonly observed: string }
  | { readonly kind: "failed"; readonly task: string; readonly observed: string }
  | { readonly kind: "unlinked" }
  | { readonly kind: "ignored"; readonly why: "not_watched" | "ambiguous_unwatched" | "no_exit_code" };

const tokens = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);
const URLS = /https?:\/\/\S+/g;

const URL_REPO = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\//;

/** The line's repo: `-R`/`--repo`, else a GitHub URL in the command (`gh pr merge <url>`), else the session's. */
function lineRepo(line: ShellLine): string | null {
  const t = tokens(line.command);
  const i = t.findIndex((w) => w === "-R" || w === "--repo");
  const flag = i >= 0 ? t[i + 1] : t.find((w) => w.startsWith("--repo="))?.slice("--repo=".length);
  return (flag ?? URL_REPO.exec(line.command)?.[1] ?? line.repo)?.toLowerCase() ?? null;
}

function verifyRepo(v: VerifySpec | null): string | null {
  if (!v) return null;
  if (v.kind === "run_ok" || v.kind === "pr_found") return v.repo;
  if (v.kind === "pr_merged") return v.pr.split("#")[0] ?? null;
  return null;
}

/** Every piece of the hint is a token of the command, in any order: `gh workflow run x.yml` needs x.yml. */
export function hintMatches(hint: string, command: string): boolean {
  const have = new Set(tokens(command));
  const want = tokens(hint);
  return want.length > 0 && want.every((w) => have.has(w));
}

function prMatches(v: VerifySpec | null, command: string): boolean {
  if (v?.kind !== "pr_merged") return false;
  const [repo, n] = v.pr.split("#");
  const esc = (s: string) => s.replace(/[.]/g, "\\.");
  return new RegExp(`github\\.com/${esc(repo ?? "")}/pull/${n}(?![0-9])`).test(command.toLowerCase());
}

/** Owner items a line may answer: open, the owner's, created before the line (guard (가)). */
function candidates(input: ViewInput, facts: readonly OwnerItemFacts[], line: ShellLine, cfg: Pick<OwnerConfig, "waitMinutes">) {
  const marks = ownerMarks(input, cfg);
  const repo = lineRepo(line);
  return facts.flatMap((f) => {
    const m = marks.get(f.task);
    if (f.state !== "ready" || !isOwnerItem(f) || !m || (m.createdAt !== null && !(Date.parse(line.ts) >= Date.parse(m.createdAt)))) return [];
    // An item that names a repo links only a line whose repo is known and the same.
    const want = verifyRepo(m.verify);
    if (want && want !== repo) return [];
    const hit = (m.cmdHint !== null && hintMatches(m.cmdHint, line.command)) || prMatches(m.verify, line.command);
    return hit ? [{ task: f.task, verify: m.verify }] : [];
  });
}

const watched = (command: string, cfg: Pick<OwnerConfig, "watchCommands">) => {
  const t = tokens(command).join(" ");
  return cfg.watchCommands.some((w) => t === w || t.startsWith(`${w} `));
};

/**
 * Decision 91⑥(2): a line links to an open owner item only when exactly one item's cmd_hint (every
 * piece) or linked PR matches it in the same repo. A link puts a mark on, nothing more; it never
 * moves a state. A failed line links as failed and puts no mark on. A watched command that links to
 * nothing is owner_act_unlinked; any other line leaves nothing.
 */
export function linkShell(input: ViewInput, facts: readonly OwnerItemFacts[], line: ShellLine, cfg: Pick<OwnerConfig, "waitMinutes" | "watchCommands"> = OWNER_DEFAULTS): ShellLink {
  const hits = candidates(input, facts, line, cfg);
  const one = hits.length === 1 ? hits[0] : undefined;
  if (!one) return watched(line.command, cfg) ? { kind: "unlinked" } : { kind: "ignored", why: hits.length > 1 ? "ambiguous_unwatched" : "not_watched" };
  const urls = line.stdout.match(URLS) ?? [];
  const observed = [...urls, line.command].join(" ").slice(0, 500);
  const stderr = line.stderr.trim();
  if (line.exitCode === null && stderr === "") {
    // Guard (나): with no exit code, only stdout naming what the verify expects links.
    const repo = verifyRepo(one.verify);
    const expected = one.verify?.kind === "run_ok" ? urls.some((u) => repo !== null && u.toLowerCase().includes(`github.com/${repo}/actions/runs/`)) : false;
    return expected ? { kind: "seen", task: one.task, observed } : { kind: "ignored", why: "no_exit_code" };
  }
  if (line.exitCode !== 0 || stderr !== "") {
    const first = stderr.split("\n")[0] ?? "";
    return { kind: "failed", task: one.task, observed: `exit ${line.exitCode ?? "?"}${first ? `: ${first}` : ""}`.slice(0, 500) };
  }
  return { kind: "seen", task: one.task, observed };
}

/**
 * Writes what linkShell decided, once per transcript line, its text masked (decision 34). Returns
 * null for an ignored line. `ownerAction` is the seq of the line's owner_action row, kept in subject.
 * Older rows under `evidence:<uuid>:owner_act` / `owner_act_unlinked:<uuid>` are read by type, and
 * the hook never links a line whose owner_action row exists, so no line gets both key forms.
 */
export function recordShellLink(store: Pick<Store, "append">, line: ShellLine, link: ShellLink, source = "hook:owner_input", ownerAction?: number): Appended | null {
  if (link.kind === "ignored") return null;
  const subject = ownerAction === undefined ? {} : { subject: `owner_action:${ownerAction}` };
  if (link.kind === "unlinked") {
    return store.append({
      type: "owner_act_unlinked",
      source,
      payload: { act: mask(line.command).slice(0, 500) },
      ...subject,
      dedupe_key: dedupeKey(EVENTS.owner_act_unlinked, "owner_act", line.uuid),
    });
  }
  return store.append({
    type: "evidence",
    source,
    payload: { kind: `owner_act:${link.kind}`, observed: mask(link.observed), ...(line.exitCode !== null ? { exit_code: line.exitCode } : {}) },
    entity: "task",
    entity_id: link.task,
    ...subject,
    dedupe_key: dedupeKey(EVENTS.evidence, "owner_act", line.uuid),
  });
}

export type ChatLink =
  | { readonly kind: "decision"; readonly decisions: readonly string[] }
  | { readonly kind: "proposed"; readonly items: readonly string[] }
  | { readonly kind: "none" };

/**
 * A chat line's only explicit link is a dNNN (row 1, U8's decision_answer). An iNNN alone, or no
 * number, is a proposal at most (rows 3, 4): it changes no state and puts no mark on.
 */
export function linkChat(text: string): ChatLink {
  const decisions = [...new Set(text.match(/\bd[0-9]{3,}\b/g) ?? [])];
  if (decisions.length > 0) return { kind: "decision", decisions };
  const items = [...new Set(text.match(/\bi[0-9]{3,}\b/g) ?? [])];
  return items.length > 0 ? { kind: "proposed", items } : { kind: "none" };
}

/** The orchestrator's proposal on an item (owner_act:proposed): a record only, no mark, no state. */
export function recordProposal(store: Pick<Store, "append">, task: string, ownerAction: number, source = "mcp:orchestrator"): Appended {
  return store.append({
    type: "evidence",
    source,
    payload: { kind: "owner_act:proposed", observed: `owner_action ${ownerAction}` },
    entity: "task",
    entity_id: task,
    subject: String(ownerAction),
  });
}

/** Seqs of owner_act_unlinked rows the orchestrator has since linked (decision 91⑤): a row naming `act:<seq>` in subject. */
export function linkedActs(events: readonly StoredEvent[]): Set<number> {
  const out = new Set<number>();
  for (const e of events) {
    const m = /^act:([1-9][0-9]*)$/.exec(e.subject ?? "");
    if (m && (e.type === "decision_answered" || e.type === "evidence")) out.add(Number(m[1]));
  }
  return out;
}
