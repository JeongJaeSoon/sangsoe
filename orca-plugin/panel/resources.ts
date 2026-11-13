// The 리소스 section at the bottom of the panel (decision 234): folded by default, its open state in
// Orca's plugin storage, read only when the owner opens or refreshes it. 정리 shows what it will take
// and runs only after the second press. Declared by hand: this folder imports nothing from the core.
import { esc, type Refusal } from "./view.ts";

type Reading<T> = { ok: true; value: T } | { ok: false; why: string };
type Usage = { count: number; kb: number | null };
export type ResRow = { ref: string; name: string; path: string; gone: boolean; state: string; why: string; kb: number | null };
export type ResView = {
  at: string;
  load: Reading<{ level: "ok" | "warn" | "danger"; reasons: string[]; loadPerCpu?: number; memFreePct?: number; diskFreeGb?: number }>;
  episode: { state: "high" | "ok" | "none"; since?: string; reason?: string };
  made: {
    worktrees: Reading<Usage>;
    terminals: Reading<{ count: number }>;
    processes: Reading<{ claude: Usage; node: Usage }>;
    tmp: Reading<Usage>;
  };
  worktrees: Reading<{ rows: ResRow[]; markOnly: boolean; unseen: string[] }>;
  tmp: Reading<Usage>;
  trash: boolean;
};
export type Reaped = { reaped: string[]; blocked: { kind: string; ref: string; reason: string }[]; skipped: string[]; tmp: { moved: number; left: number } | null };

export type ResState =
  | { kind: "idle" }
  | { kind: "reading"; last?: ResView }
  | { kind: "shown"; view: ResView; confirm?: boolean; running?: boolean; result?: Reaped }
  | { kind: "failed"; refusal: Refusal };

export const RES_OPEN_KEY = "resources.open";
/** A reading older than this is marked 낡음: nothing refreshes it but the owner. */
export const STALE_MS = 5 * 60_000;

const LEVEL = { ok: "보통", warn: "경고", danger: "위험" } as const;
const STATE = { finished: "끝남", no_trace: "PR·Dispatch 없음", unknown: "알 수 없음" } as Record<string, string>;
const BLOCK: Record<string, string> = {
  uncommitted: "커밋 안 된 변경",
  unpushed: "푸시 안 된 커밋",
  unpushed_other_patch: "원격과 다른 커밋",
  task_open: "열린 Task",
  session_alive: "살아 있는 세션",
  evidence_in_worktree: "안에 남은 증거 파일",
  listener: "열린 포트",
  compose_running: "도는 compose",
  docker_unreachable: "Docker 응답 없음",
  archive_hook_failed: "archive hook 실패",
};

export function size(kb: number | null): string {
  if (kb === null) return "크기 모름";
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(kb < 10 * 1024 ? 1 : 0)} MB`;
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

const n = (x: number) => x.toLocaleString("ko-KR");
const unread = (why: string) => `<span class="unread" title="${esc(why)}">읽지 못함</span>`;
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** A thin bar: how full the gauge is, toned by the level the one load judgment gave that metric. */
function gauge(label: string, value: string, pct: number, tone: string): string {
  const w = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="gauge"><span class="g-l">${esc(label)}</span><span class="g-bar" role="img" aria-label="${esc(`${label} ${value}`)}"><i class="${tone}" style="width:${w}%"></i></span><span class="g-v">${esc(value)}</span></div>`;
}

const toneOf = (reasons: readonly string[], metric: string) => {
  const hit = reasons.find((r) => r.startsWith(metric));
  return hit ? (hit.includes("위험") ? "t-bad" : "t-warn") : "";
};

function loadBlock(v: ResView): string {
  const ep =
    v.episode.state === "high"
      ? `<p class="ep t-bad">${esc(hhmm(v.episode.since ?? ""))}부터 부하 높음${v.episode.reason ? `: ${esc(v.episode.reason)}` : ""}</p>`
      : v.episode.state === "ok"
        ? `<p class="ep">${esc(hhmm(v.episode.since ?? ""))}부터 부하 정상</p>`
        : "";
  if (!v.load.ok) return `<h3>PC 부하</h3><p class="ep">${unread(v.load.why)}</p>${ep}`;
  const l = v.load.value;
  const rows = [
    l.loadPerCpu !== undefined ? gauge("CPU", `${l.loadPerCpu.toFixed(2)} / 코어`, (l.loadPerCpu / 2) * 100, toneOf(l.reasons, "load/CPU")) : gauge("CPU", "모름", 0, ""),
    l.memFreePct !== undefined ? gauge("메모리 여유", `${Math.round(l.memFreePct)}%`, l.memFreePct, toneOf(l.reasons, "메모리")) : gauge("메모리 여유", "모름", 0, ""),
    l.diskFreeGb !== undefined ? `<div class="gauge"><span class="g-l">디스크 여유</span><span class="g-v wide ${toneOf(l.reasons, "디스크")}">${n(Math.round(l.diskFreeGb))} GB</span></div>` : "",
  ];
  return `<h3>PC 부하 <span class="badge ${l.level === "ok" ? "" : l.level === "warn" ? "t-run" : "t-bad"}">${LEVEL[l.level]}</span></h3>${rows.join("")}${ep}`;
}

function madeBlock(v: ResView): string {
  const cell = <T>(r: Reading<T>, f: (x: T) => [string, string]) => {
    if (!r.ok) return `<td colspan="2">${unread(r.why)}</td>`;
    const [count, kb] = f(r.value);
    return `<td class="num">${count}</td><td class="num">${kb}</td>`;
  };
  const usage = (u: Usage): [string, string] => [n(u.count), size(u.kb)];
  const m = v.made;
  const rows: [string, string][] = [
    ["worktree", cell(m.worktrees, usage)],
    ["터미널", cell(m.terminals, (t) => [n(t.count), ""])],
    ["claude 프로세스", cell(m.processes, (p) => usage(p.claude))],
    ["node 프로세스", cell(m.processes, (p) => usage(p.node))],
    ["임시 폴더", cell(m.tmp, usage)],
  ];
  return (
    `<h3>sangsoe 가 만든 것</h3><table class="tbl res"><thead><tr><th>종류</th><th class="num">개수</th><th class="num">크기</th></tr></thead><tbody>` +
    rows.map(([k, c]) => `<tr><td>${k}</td>${c}</tr>`).join("") +
    `</tbody></table><p class="foot">프로세스는 보여 주기만 한다. 끝내지 않는다.</p>`
  );
}

/** What 정리 would take: the confirm list is exactly this. */
export function reapTargets(v: ResView): { worktrees: string[]; tmp: boolean } {
  const worktrees = v.worktrees.ok && !v.worktrees.value.markOnly ? v.worktrees.value.rows.map((r) => r.ref) : [];
  return { worktrees, tmp: v.trash && v.tmp.ok && v.tmp.value.count > 0 };
}

function candidates(v: ResView, s: Extract<ResState, { kind: "shown" }>, stale: boolean): string {
  const head = `<h3>정리 후보</h3>`;
  const rows: string[] = [];
  const notes: string[] = [];
  if (!v.worktrees.ok) notes.push(`worktree 후보를 ${unread(v.worktrees.why)}. 하나라도 못 읽으면 worktree 는 정리하지 않는다.`);
  else {
    for (const r of v.worktrees.value.rows) {
      const why = r.gone ? "경로 없음: 등록만 지움" : (STATE[r.state] ?? r.state) + (r.state === "finished" ? ` (${r.why})` : "");
      rows.push(`<tr><td class="title" title="${esc(`${r.name}: ${r.path}`)}">${esc(r.name)}</td><td title="${esc(why)}">${esc(why)}</td><td class="num">${size(r.kb)}</td></tr>`);
    }
    if (v.worktrees.value.markOnly) notes.push("reaper 설정이 없어 worktree 는 정리하지 않는다. sangsoe doctor 를 본다.");
  }
  if (!v.tmp.ok) notes.push(`임시 폴더를 ${unread(v.tmp.why)}.`);
  else if (v.tmp.value.count > 0) {
    const label = `임시 폴더 ${n(v.tmp.value.count)}개`;
    const why = "한 시간 넘게 남은 시험용 폴더";
    rows.push(`<tr><td class="title" title="${label}">${label}</td><td title="${why}">${why}</td><td class="num">${size(v.tmp.value.kb)}</td></tr>`);
    if (!v.trash) notes.push("이 기계에 휴지통 명령(trash)이 없어 임시 폴더는 정리하지 않는다.");
  }
  const t = reapTargets(v);
  const total = t.worktrees.length + (t.tmp ? 1 : 0);
  if (rows.length === 0) return `${head}<p class="empty">정리할 것 없음</p>${notes.map((x) => `<p class="foot">${x}</p>`).join("")}`;
  const table = `<table class="tbl res"><thead><tr><th>이름</th><th>왜</th><th class="num">크기</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const off = s.running ? " disabled" : "";
  const act =
    total === 0
      ? ""
      : stale
        ? `<p class="foot">5분 넘게 지난 읽음이다. 새로 고친 뒤 정리한다.</p>`
        : s.confirm
        ? `<div class="confirm" role="group" aria-label="정리 확인"><p>위 ${total}건을 정리한다. worktree 는 Orca 가 지우기 전에 미커밋·미푸시·열린 PR·살아 있는 세션을 다시 보고, 폴더는 휴지통으로 간다.</p><button type="button" class="btn primary" data-res="run"${off}>${total}건 정리</button><button type="button" class="btn" data-res="cancel"${off}>취소</button></div>`
        : `<div class="res-acts"><button type="button" class="btn" data-res="ask">정리…</button></div>`;
  return `${head}${table}${notes.map((x) => `<p class="foot">${x}</p>`).join("")}${act}`;
}

function resultNote(r: Reaped): string {
  const cards = r.reaped.filter((x) => x.startsWith("worktree:")).length;
  const parts = [`worktree ${cards}건 정리`];
  if (r.reaped.length > cards) parts.push(`Docker ${r.reaped.length - cards}건 정리`);
  if (r.tmp) parts.push(`임시 폴더 ${n(r.tmp.moved)}개 휴지통으로${r.tmp.left ? `, ${n(r.tmp.left)}개 남음` : ""}`);
  const blocked = r.blocked.map((b) => `${b.ref}: ${BLOCK[b.reason] ?? b.reason}`);
  const title = [...blocked, ...r.skipped].join("\n");
  const tail = blocked.length + r.skipped.length > 0 ? `, 막힘·건너뜀 ${blocked.length + r.skipped.length}건` : "";
  return `<p class="msg" role="status"${title ? ` title="${esc(title)}"` : ""}>${esc(parts.join(", ") + tail)}</p>`;
}

/** The body inside the fold for one state; `now` decides 낡음. */
export function renderResBody(s: ResState, now: number): string {
  if (s.kind === "idle") return "";
  if (s.kind === "failed") {
    return `<p class="msg bad" role="status" title="${esc([s.refusal.code, s.refusal.reason].join(" · "))}">리소스를 읽지 못했다. <button type="button" class="link" data-res="refresh">새로 고침</button></p>`;
  }
  const v = s.kind === "reading" ? s.last : s.view;
  const age = v ? now - Date.parse(v.at) : 0;
  const stamp = s.kind === "reading" ? `<span class="fresh" aria-live="polite">읽는 중…</span>` : `<span class="fresh${age > STALE_MS ? " stale" : ""}">${esc(hhmm(v?.at ?? ""))} 읽음${age > STALE_MS ? ", 낡음" : ""}</span>`;
  const busy = s.kind === "reading" || (s.kind === "shown" && s.running === true);
  const tools = `<div class="res-h">${stamp}<button type="button" class="link" data-res="refresh"${busy ? " disabled" : ""}>새로 고침</button></div>`;
  if (!v) return tools;
  const shown: Extract<ResState, { kind: "shown" }> = s.kind === "shown" ? s : { kind: "shown", view: v };
  const list = candidates(v, s.kind === "reading" ? { ...shown, running: true, confirm: false } : shown, s.kind === "shown" && age > STALE_MS);
  return `${tools}${shown.result ? resultNote(shown.result) : ""}${loadBlock(v)}${madeBlock(v)}${list}`;
}

/** The whole section: a fold, closed unless the owner left it open. */
export function renderResources(s: ResState, open: boolean, now: number): string {
  return `<details class="fold res-fold"${open ? " open" : ""}><summary>리소스</summary><div class="res-body">${open ? renderResBody(s, now) : ""}</div></details>`;
}
