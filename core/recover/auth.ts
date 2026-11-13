import type { StoredEvent } from "../contract/index.ts";
import { dedupeKey, EVENTS } from "../contract/index.ts";
import type { OrcaAdapter, OrcaResult, Receipt } from "../contract/orca.ts";
import { recoverWrite } from "../orca/adapter.ts";
import { LOCAL_HOST } from "../orca/host-filter.ts";
import { openWaits } from "../owner/release.ts";
import { hashOf, summarize } from "../session/mask.ts";
import type { Store } from "../store/store.ts";
import { settled } from "./recover.ts";

/** Fixed (lead, U115 Q3): a new turn in the same process, the recovery decision 237 ① saw work. */
export const AUTH_RECOVER_LINE = "로그인을 다시 했습니다. 멈춘 곳에서 이어서 진행해 주세요.";
const WAIT_SUBMIT_S = 10;

type Stop = { seq: number; kind: "dispatch" | "session"; who: string; task?: string; worktree?: string };

export type AuthRow = {
  stop: number;
  kind: Stop["kind"];
  /** The Dispatch id, or the session id of a session holding none. */
  who: string;
  terminal: string | null;
  verdict: "would_send" | "sent" | "undetermined" | "already" | "failed" | "skip";
  why?: string;
  /** An Orca read failed, so the row says nothing about the session: the command exits 1. */
  unread?: true;
};

export type AuthOrca = Pick<OrcaAdapter, "workerShow" | "worktreePs" | "terminalList" | "terminalSend" | "requestShow">;

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const sentKey = (seq: number) => dedupeKey(EVENTS.owner_action, "recover_auth", String(seq));
const KEY_PREFIX = sentKey(0).slice(0, -1);

/** The Dispatch or session an auth stop row belongs to, open or not. */
function whoOf(e: StoredEvent): string | undefined {
  if (e.payload.cause !== "auth") return undefined;
  if (e.type === "worker_dead" && e.entity === "dispatch") return str(e.entity_id);
  if (e.type === "waiting_human") return str(e.payload.dispatch) ?? str(e.payload.session);
  return undefined;
}

/**
 * Sessions whose latest stop was a lost login and that have not ended a turn since (decision 237):
 * a Dispatch's worker_dead{cause auth} not followed by a worker_idle or another worker_dead of its
 * Task, and an open waiting_human{cause auth}, of a Dispatch or of a session holding none.
 */
function authStops(events: readonly StoredEvent[]): Stop[] {
  const last = new Map<string, StoredEvent>();
  const idle = new Map<string, number>();
  for (const e of events) {
    const task = e.type === "worker_dead" && e.entity === "dispatch" ? str(e.target) : e.type === "worker_idle" && e.entity === "task" ? str(e.entity_id) : undefined;
    if (task) last.set(task, e);
    if (task && e.type === "worker_idle") idle.set(task, e.seq);
  }
  const stops: Stop[] = [];
  for (const [task, e] of last) {
    if (e.type === "worker_dead" && e.payload.cause === "auth" && e.entity_id) stops.push({ seq: e.seq, kind: "dispatch", who: e.entity_id, task });
  }
  for (const w of openWaits(events)) {
    if (w.payload.cause !== "auth") continue;
    const dispatch = str(w.payload.dispatch);
    const session = str(w.payload.session);
    const worktree = str(w.payload.worktree);
    // The monitor releases a Dispatch's wait only on its next round; the Stop hook's worker_idle is sooner.
    const task = w.entity === "task" ? str(w.entity_id) : undefined;
    if (dispatch && task && (idle.get(task) ?? 0) > w.seq) continue;
    if (dispatch) stops.push({ seq: w.seq, kind: "dispatch", who: dispatch, ...(task ? { task } : {}) });
    else if (session) stops.push({ seq: w.seq, kind: "session", who: session, ...(worktree ? { worktree } : {}) });
  }
  return stops.sort((a, b) => a.seq - b.seq);
}

/**
 * The seq of the last line sent per Dispatch or session. A stop recorded before that line is covered
 * by it: a Dispatch's worker_dead and its waiting_human are one stop seen twice.
 */
function lastSent(events: readonly StoredEvent[]): Map<string, number> {
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "owner_action" || !e.dedupe_key?.startsWith(KEY_PREFIX)) continue;
    const stop = bySeq.get(Number(e.dedupe_key.slice(KEY_PREFIX.length)));
    const who = stop && whoOf(stop);
    if (who) out.set(who, e.seq);
  }
  return out;
}

type Found = { terminal: string } | { terminal: null; why: string; unread?: true };

async function dispatchTerminal(orca: AuthOrca, dispatch: string): Promise<Found> {
  const w = await orca.workerShow({ dispatch });
  if (!w.ok) return { terminal: null, why: `worker-show 실패 (${w.error.code})`, unread: true };
  if (settled(w.value)) return { terminal: null, why: `Dispatch 끝남 (${w.value.state})` };
  if (w.value.liveness !== "live") return { terminal: null, why: `터미널이 살아 있지 않음 (${w.value.liveness ?? "?"})` };
  return w.value.terminal ? { terminal: w.value.terminal } : { terminal: null, why: "worker-show 에 터미널이 없음" };
}

/** No session → terminal guess: only a worktree with exactly one agent terminal names it. */
async function sessionTerminal(orca: AuthOrca, worktree: string | undefined, ps: () => ReturnType<AuthOrca["worktreePs"]>): Promise<Found> {
  if (!worktree) return { terminal: null, why: "멈춘 곳의 worktree 를 모름" };
  const rows = await ps();
  if (!rows.ok) return { terminal: null, why: `worktree ps 실패 (${rows.error.code})`, unread: true };
  // A partial list proves neither that the worktree is gone nor that it holds one agent terminal.
  const partial = (v: { truncated: boolean; omittedHostIds: readonly string[] }) => v.truncated || v.omittedHostIds.includes(LOCAL_HOST);
  if (partial(rows.value)) return { terminal: null, why: "worktree ps 목록이 잘림", unread: true };
  const tree = rows.value.rows.find((t) => t.worktreeInstanceId === worktree);
  if (!tree) return { terminal: null, why: "worktree 가 Orca 에 없음" };
  const list = await orca.terminalList({ worktree: `id:${tree.worktreeId}` });
  if (!list.ok) return { terminal: null, why: `terminal list 실패 (${list.error.code})`, unread: true };
  if (partial(list.value)) return { terminal: null, why: "terminal list 목록이 잘림", unread: true };
  const agents = list.value.rows.filter((t) => t.agentIdentity);
  if (agents.length === 1 && agents[0]) return { terminal: agents[0].handle };
  return { terminal: null, why: agents.length === 0 ? "에이전트 터미널이 없음" : `에이전트 터미널이 ${agents.length}개라 고르지 않음` };
}

/**
 * Refusals that come before any byte reaches the terminal: sangsoe's own argv check, an unknown handle
 * (`terminal_handle_stale` measured on `terminal show`), a prompt Orca would not type over an open menu
 * (decision 86 ③).
 */
const NOT_WRITTEN = new Set(["invalid_argument", "terminal_handle_stale", "terminal_not_found", "agent_prompt_blocked"]);

/**
 * Decision 60: any other failure may have typed the line (a submit wait that timed out included), so it
 * is replayed only under Orca's request id, never sent fresh. `refused` is true only for NOT_WRITTEN,
 * from the send or from its replay, which answers the request's own result.
 */
async function send(orca: AuthOrca, terminal: string): Promise<OrcaResult<Receipt> & { refused: boolean }> {
  const a = { terminal, text: AUTH_RECOVER_LINE, enter: true, waitSubmit: WAIT_SUBMIT_S };
  const first = await orca.terminalSend(a);
  if (first.ok || !first.requestId || NOT_WRITTEN.has(first.error.code)) return { ...first, refused: !first.ok && NOT_WRITTEN.has(first.error.code) };
  let replayed: OrcaResult<Receipt> | undefined;
  const r = await recoverWrite(orca, first.requestId, async (o) => (replayed = await orca.terminalSend(a, o)));
  return { ...r, refused: replayed !== undefined && !replayed.ok && NOT_WRITTEN.has(replayed.error.code) };
}

/**
 * Decision 246: the owner's one command after signing in again. The dry run (send false) reads and
 * writes nothing; `send` writes one owner_action per line, keyed by the stop, so a stop gets one line
 * however often the command runs. A send refused before writing records nothing and is tried again
 * next run; any other failure is recorded too, since the line may have arrived.
 */
export async function authRecover(store: Store, orca: AuthOrca, o: { send: boolean }): Promise<{ rows: AuthRow[] }> {
  const events = store.events();
  const sent = lastSent(events);
  let psRead: ReturnType<AuthOrca["worktreePs"]> | undefined;
  const ps = () => (psRead ??= orca.worktreePs({}));
  const terminals = new Set<string>();
  const rows: AuthRow[] = [];
  for (const s of authStops(events)) {
    const row = { stop: s.seq, kind: s.kind, who: s.who };
    if ((sent.get(s.who) ?? 0) > s.seq) {
      const why = s.kind === "session" ? "이미 보냈다. 다시 멈췄으면 그 세션을 claude --continue 로 다시 띄운다(결정 237)" : "이 정지에는 이미 보냈다";
      rows.push({ ...row, terminal: null, verdict: "already", why });
      continue;
    }
    const found = s.kind === "dispatch" ? await dispatchTerminal(orca, s.who) : await sessionTerminal(orca, s.worktree, ps);
    if (found.terminal === null) {
      rows.push({ ...row, terminal: null, verdict: "skip", why: found.why, ...(found.unread ? { unread: true as const } : {}) });
      continue;
    }
    if (terminals.has(found.terminal)) {
      rows.push({ ...row, terminal: found.terminal, verdict: "skip", why: "같은 터미널을 앞 정지가 맡음" });
      continue;
    }
    terminals.add(found.terminal);
    if (!o.send) {
      rows.push({ ...row, terminal: found.terminal, verdict: "would_send" });
      continue;
    }
    const r = await send(orca, found.terminal);
    if (!r.ok && r.refused) {
      rows.push({ ...row, terminal: found.terminal, verdict: "failed", why: `${r.error.code}: ${r.error.message}` });
      continue;
    }
    const said = `sangsoe recover auth --send: w${s.seq} → ${found.terminal}`;
    store.appendOwnerAction(
      {
        type: "owner_action",
        source: "recover auth",
        ...(s.task ? { entity: "task", entity_id: s.task } : {}),
        dedupe_key: sentKey(s.seq),
        payload: { origin: "shell", summary: summarize(said), hash: hashOf(said) },
      },
      said,
    );
    if (r.ok) rows.push({ ...row, terminal: found.terminal, verdict: "sent" });
    else rows.push({ ...row, terminal: found.terminal, verdict: "undetermined", why: `${r.error.code}: 닿았는지 터미널에서 확인한다` });
  }
  return { rows };
}

const VERDICT: Record<AuthRow["verdict"], string> = {
  would_send: "보낼 것",
  sent: "보냄",
  undetermined: "보냈는지 모름",
  already: "이미 보냄",
  failed: "실패",
  skip: "건너뜀",
};

export function renderAuthRecover(r: { rows: AuthRow[] }, send: boolean): string[] {
  const lines = ["먼저 아무 세션에서든 /login 을 한 번 마친다. 이 명령은 로그인을 확인하지 않는다.", ""];
  if (r.rows.length === 0) return [...lines, "로그인을 잃고 멈춘 세션이 없다."];
  lines.push("| 정지 | 종류 | Dispatch·세션 | 터미널 | 판정 | 이유 |", "|---|---|---|---|---|---|");
  for (const x of r.rows) lines.push(`| w${x.stop} | ${x.kind} | ${x.who} | ${x.terminal ?? "—"} | ${VERDICT[x.verdict]} | ${x.why ?? ""} |`);
  lines.push("", `보내는 줄: ${AUTH_RECOVER_LINE}`);
  if (!send) lines.push("dry run: 아무 터미널에도 보내지 않았고 아무것도 기록하지 않았다. 보내려면 sangsoe recover auth --send");
  return lines;
}
