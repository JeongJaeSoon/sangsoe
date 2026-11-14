// The 리소스 section at the bottom of the panel (decision 234): folded by default, its open state in
// Orca's plugin storage, read only when the owner opens or refreshes it. 정리 shows what it will take
// and runs only after the second press. Declared by hand: this folder imports nothing from the core.
import { esc, type Refusal } from "./view.ts";

type Reading<T> = { ok: true; value: T } | { ok: false; why: string };
type Usage = { count: number; kb: number | null };
type Reply<T> = { ok: true; value: T } | { ok: false; refusal: Refusal };
export type ResRow = { ref: string; name: string; path: string; gone: boolean; state: string; why: string; kb: number | null };
export type BandState = "ok" | "warn" | "danger" | "unknown";
export type Band = { from: string; to: string; spans: { from: string; to: string; state: BandState }[] };
export type ResView = {
  at: string;
  load: Reading<{ level: "ok" | "warn" | "danger"; reasons: string[]; loadPerCpu?: number; memFreePct?: number; diskFreeGb?: number }>;
  episode: { state: "high" | "ok" | "none"; since?: string; reason?: string };
  /** Absent from a core older than decision 235. */
  band?: Band | null;
  made: {
    worktrees: Reading<Usage>;
    terminals: Reading<{ count: number }>;
    processes: Reading<{ claude: Usage; node: Usage }>;
    tmp: Reading<Usage>;
    /** Decision 240; absent from an older core. */
    recorded?: { kind: string; ref: string; owner: string; since: string }[];
  };
  worktrees: Reading<{ rows: ResRow[]; markOnly: boolean; unseen: string[] }>;
  tmp: Reading<Usage>;
  trash: boolean;
};
export type Reaped = { reaped: string[]; blocked: { kind: string; ref: string; reason: string }[]; skipped: string[]; tmp: { moved: number; left: number } | null };

/** Decision 235: the section comes in three parts, each painted as it arrives. */
export type PartName = "load" | "made" | "candidates";
export const PARTS: readonly PartName[] = ["load", "made", "candidates"];
type LoadPart = Pick<ResView, "at" | "load" | "episode" | "band"> & { part: "load" };
type MadePart = Pick<ResView, "at" | "made"> & { part: "made" };
type CandPart = Pick<ResView, "at" | "worktrees" | "tmp" | "trash"> & { part: "candidates" };
export type Got = { load?: Reply<LoadPart>; made?: Reply<MadePart>; candidates?: Reply<CandPart> };

export type ResState =
  | { kind: "idle" }
  /** `last`: the view a refresh started from, standing in for each part until its new answer comes; `result`: the 정리 this read follows. */
  | { kind: "reading"; got: Got; last?: ResView | undefined; result?: Reaped | undefined }
  | { kind: "shown"; view: ResView; confirm?: boolean; running?: boolean; result?: Reaped }
  | { kind: "failed"; refusal: Refusal };

/** The whole view from three settled parts; a part that failed is unread in its own block. */
function assemble(got: Required<Got>): ResState {
  const { load: l, made: m, candidates: c } = got;
  if (!l.ok && !m.ok && !c.ok) return { kind: "failed", refusal: l.refusal };
  const no = (r: Reply<unknown>) => ({ ok: false as const, why: r.ok ? "" : r.refusal.reason });
  const at = [l, m, c].flatMap((r) => (r.ok ? [r.value.at] : [])).sort()[0] ?? "";
  return {
    kind: "shown",
    view: {
      at,
      load: l.ok ? l.value.load : no(l),
      episode: l.ok ? l.value.episode : { state: "none" },
      band: l.ok ? (l.value.band ?? null) : null,
      made: m.ok ? m.value.made : { worktrees: no(m), terminals: no(m), processes: no(m), tmp: no(m) },
      worktrees: c.ok ? c.value.worktrees : no(c),
      tmp: c.ok ? c.value.tmp : no(c),
      trash: c.ok && c.value.trash,
    },
  };
}

/**
 * Asks for the three parts at once and paints after each answer. A core older than decision 235
 * refuses parts; the section is then read whole, once.
 */
export async function readParts(request: (input?: { part: PartName }) => Promise<unknown>, paint: (s: ResState) => void): Promise<ResState> {
  const failed = (e: unknown): Reply<never> => ({ ok: false, refusal: { code: "request_failed", reason: String(e), fix: "reopen the panel" } });
  const got: Got = {};
  await Promise.all(
    PARTS.map(async (part) => {
      const r = (await request({ part }).catch(failed)) as Reply<never>;
      got[part] = r;
      if (Object.keys(got).length < PARTS.length) paint({ kind: "reading", got: { ...got } });
    }),
  );
  let end: ResState;
  if (PARTS.every((p) => got[p]?.ok === false && got[p].refusal.code === "core_old")) {
    const whole = (await request().catch(failed)) as Reply<ResView>;
    end = whole.ok ? { kind: "shown", view: { ...whole.value, band: whole.value.band ?? null } } : { kind: "failed", refusal: whole.refusal };
  } else end = assemble(got as Required<Got>);
  paint(end);
  return end;
}

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

const HOUR = 3_600_000;
const BAND_WORD: Record<BandState, string> = { danger: "위험", warn: "경고", ok: "보통", unknown: "모름" };

function span(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min}분` : `${Math.round(min / 6) / 10}시간`;
}

/** Decision 235: the levels of the last `hours`, from the episode rows only; no sample is stored. */
function bandBlock(b: Band, hours: 6 | 24): string {
  const to = Date.parse(b.to);
  const from = to - hours * HOUR;
  const x = (t: number) => Math.round(((t - from) / (to - from)) * 1000);
  const total = new Map<BandState, number>();
  const rects: string[] = [];
  for (const s of b.spans) {
    const a = Math.max(from, Date.parse(s.from));
    const z = Math.min(to, Date.parse(s.to));
    if (z <= a) continue;
    total.set(s.state, (total.get(s.state) ?? 0) + z - a);
    rects.push(`<rect class="s-${s.state}" x="${x(a)}" width="${x(z) - x(a)}" height="8"/>`);
  }
  const said = (["danger", "warn", "ok", "unknown"] as const).flatMap((k) => (total.get(k) ? [`${BAND_WORD[k]} ${span(total.get(k) ?? 0)}`] : []));
  return (
    `<svg class="band" viewBox="0 0 1000 8" preserveAspectRatio="none" role="img" aria-label="${esc(`최근 ${hours}시간 부하: ${said.join(", ")}`)}">${rects.join("")}</svg>` +
    `<div class="band-ax"><span>${hours}시간 전</span><span>지금</span></div>` +
    `<p class="band-lg">${(["warn", "danger", "ok", "unknown"] as const).map((k) => `<span><svg class="sw" viewBox="0 0 8 8" aria-hidden="true"><rect class="s-${k}" x="0.5" y="0.5" width="7" height="7" rx="1.5"/></svg>${BAND_WORD[k]}${k === "unknown" ? "(감시가 돌지 않음)" : ""}</span>`).join("")}</p>` +
    `<p class="ep">단계 변화만 기록된다.</p>`
  );
}

const pending = (title: string, what: string) => `<h3>${title}</h3><p class="pending" role="status">${what}</p>`;

function loadBlock(v: Pick<ResView, "load" | "episode" | "band">, hours: 6 | 24): string {
  const ep =
    v.episode.state === "high"
      ? `<p class="ep t-bad">${esc(hhmm(v.episode.since ?? ""))}부터 부하 높음${v.episode.reason ? `: ${esc(v.episode.reason)}` : ""}</p>`
      : v.episode.state === "ok"
        ? `<p class="ep">${esc(hhmm(v.episode.since ?? ""))}부터 부하 정상</p>`
        : "";
  const band = v.band ? bandBlock(v.band, hours) : "";
  const pick = v.band
    ? `<span class="rng" role="group" aria-label="기간">${([6, 24] as const).map((h) => `<button type="button" data-res="h${h}" aria-pressed="${h === hours}">${h}시간</button>`).join("")}</span>`
    : "";
  const head = (badge: string) => `<div class="load-h"><h3>PC 부하${badge}</h3>${pick}</div>`;
  if (!v.load.ok) return `${head("")}<p class="ep">${unread(v.load.why)}</p>${ep}${band}`;
  const l = v.load.value;
  const rows = [
    l.loadPerCpu !== undefined ? gauge("CPU", `${l.loadPerCpu.toFixed(2)} / 코어`, (l.loadPerCpu / 2) * 100, toneOf(l.reasons, "load/CPU")) : gauge("CPU", "모름", 0, ""),
    l.memFreePct !== undefined ? gauge("메모리 여유", `${Math.round(l.memFreePct)}%`, l.memFreePct, toneOf(l.reasons, "메모리")) : gauge("메모리 여유", "모름", 0, ""),
    l.diskFreeGb !== undefined ? `<div class="gauge"><span class="g-l">디스크 여유</span><span class="g-v wide ${toneOf(l.reasons, "디스크")}">${n(Math.round(l.diskFreeGb))} GB</span></div>` : "",
  ];
  return `${head(` <span class="badge ${l.level === "ok" ? "" : l.level === "warn" ? "t-run" : "t-bad"}">${LEVEL[l.level]}</span>`)}${rows.join("")}${ep}${band}`;
}

const OWNED = "기록됨·오너 손";

/**
 * Decision 248: of the made part the panel draws only the owner's list (decision 240); the counts it
 * also carries stay for `sangsoe reap plan`. A failed part has no list, so it says it was not read.
 */
function madeBlock(v: Pick<ResView, "made">): string {
  const m = v.made;
  if (m.recorded === undefined && !m.worktrees.ok) return `<h3>${OWNED}</h3><p class="ep">${unread(m.worktrees.why)}</p>`;
  return ownedBlock(m.recorded ?? []);
}

const KIND: Record<string, string> = { checkout: "checkout", registration: "등록", branch: "브랜치", file: "파일", process: "프로세스" };

/** Decision 240: what a session recorded and only its owner clears; there is nothing here to press. */
function ownedBlock(rows: NonNullable<ResView["made"]["recorded"]>): string {
  if (rows.length === 0) return "";
  const tr = (r: (typeof rows)[number]) => {
    const kind = KIND[r.kind] ?? r.kind;
    return `<tr><td class="k">${esc(kind)}</td><td title="${esc(`${r.ref} · ${hhmm(r.since)}부터`)}">${esc(r.ref)}</td><td class="o" title="${esc(r.owner)}">${esc(r.owner)}</td></tr>`;
  };
  return (
    `<h3>${OWNED}</h3><table class="tbl res owned"><thead><tr><th class="k">종류</th><th>이름</th><th class="o">소유</th></tr></thead><tbody>` +
    rows.map(tr).join("") +
    `</tbody></table><p class="foot">sangsoe 는 이것을 치우지 않는다. 기록한 쪽이 내리고 released 로 남긴다.</p>`
  );
}

/** The most cards one `panel.reap` takes; the rest wait for the next 정리. */
export const MAX_REAP = 200;

/** What 정리 would take: the confirm list is exactly this. */
type Cands = Pick<ResView, "worktrees" | "tmp" | "trash">;
export function reapTargets(v: Cands): { worktrees: string[]; tmp: boolean } {
  const worktrees = v.worktrees.ok && !v.worktrees.value.markOnly ? v.worktrees.value.rows.slice(0, MAX_REAP).map((r) => r.ref) : [];
  return { worktrees, tmp: v.trash && v.tmp.ok && v.tmp.value.count > 0 };
}

/** `s` null while other parts are still read: the list shows, nothing can be pressed yet. */
function candidates(v: Cands, s: { confirm?: boolean; running?: boolean } | null, stale: boolean): string {
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
    else if (v.worktrees.value.rows.length > MAX_REAP) {
      notes.push(`한 번에 worktree ${MAX_REAP}건까지 정리한다. 나머지 ${n(v.worktrees.value.rows.length - MAX_REAP)}건은 다음 정리에서.`);
    }
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
  const off = s?.running ? " disabled" : "";
  const act =
    total === 0 || !s
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

/**
 * One part while the others are still read: drawn when it came, else the last read's, else what is
 * being read. With no `what` a part still being read draws nothing.
 */
function partBlock<T>(r: Reply<T> | undefined, last: T | undefined, title: string, what: string, draw: (v: T) => string): string {
  if (!r || (!r.ok && r.refusal.code === "core_old")) return last ? draw(last) : what ? pending(title, what) : "";
  return r.ok ? draw(r.value) : `<h3>${title}</h3><p class="ep">${unread(r.refusal.reason)}</p>`;
}

type Paintable = Pick<Element, "contains" | "innerHTML"> & { querySelector(q: string): { focus(o?: FocusOptions): void } | null };
/** A press waiting for its focus target: `from` the button pressed, `to` where the keyboard should land. */
export type Want = { from: string; to: string };

/** Where the keyboard goes after a press whose button does not come back: 정리… opens the confirm, 취소 closes it, a reap ends on 새로 고침. */
export const FOCUS_AFTER: Readonly<Record<string, string>> = { ask: "run", cancel: "ask", run: "refresh" };

/**
 * Repainting replaces the buttons. The keyboard goes where the last press asked (`want.to`) or else
 * stays on the button it was on, once that button is drawn enabled; until then `want` is returned to
 * try again on the next paint. A button the user moved to since the press wins over the press, and
 * focus that left the section for somewhere else is never taken back.
 */
export function repaint(el: Paintable, html: string, active: Element | null, want: Want | null = null): Want | null {
  const inside = !!active && el.contains(active);
  const on = inside ? (active?.getAttribute("data-res") ?? null) : null;
  const moved = on !== null && want !== null && on !== want.from && on !== want.to;
  const w = moved ? null : want;
  const key = w?.to ?? on;
  const free = inside || !active || active.tagName === "BODY";
  el.innerHTML = html;
  if (!key || !free) return null;
  const to = el.querySelector(`[data-res="${key}"]:not(:disabled)`);
  to?.focus({ preventScroll: true });
  return to ? null : (w ?? { from: key, to: key });
}

/** The body inside the fold for one state; `now` decides 낡음, `hours` the band's span. */
export function renderResBody(s: ResState, now: number, hours: 6 | 24 = 6): string {
  if (s.kind === "idle") return "";
  if (s.kind === "failed") {
    return `<p class="msg bad" role="status" title="${esc([s.refusal.code, s.refusal.reason].join(" · "))}">리소스를 읽지 못했다. <button type="button" class="link" data-res="refresh">새로 고침</button></p>`;
  }
  const tools = (stamp: string, busy: boolean) =>
    `<div class="res-h">${stamp}<button type="button" class="link" data-res="refresh"${busy ? " disabled" : ""}>새로 고침</button></div>`;
  if (s.kind === "reading") {
    const g = s.got;
    return (
      tools(`<span class="fresh" aria-live="polite">읽는 중…</span>`, true) +
      (s.result ? resultNote(s.result) : "") +
      partBlock<Pick<ResView, "load" | "episode" | "band">>(g.load, s.last, "PC 부하", "부하를 읽는 중…", (v) => loadBlock(v, hours)) +
      // The owner's list is usually empty, so its reading row would only flash.
      partBlock<Pick<ResView, "made">>(g.made, s.last, OWNED, "", madeBlock) +
      // After a 정리 the last list names what was just taken, so it does not stand in.
      partBlock<Cands>(g.candidates, s.result ? undefined : s.last, "정리 후보", "끝난 worktree 를 GitHub·Orca 에 묻는 중…", (v) => candidates(v, null, false))
    );
  }
  const v = s.view;
  const age = now - Date.parse(v.at);
  const stamp = `<span class="fresh${age > STALE_MS ? " stale" : ""}">${esc(hhmm(v.at))} 읽음${age > STALE_MS ? ", 낡음" : ""}</span>`;
  return `${tools(stamp, s.running === true)}${s.result ? resultNote(s.result) : ""}${loadBlock(v, hours)}${madeBlock(v)}${candidates(v, s, age > STALE_MS)}`;
}

/** The whole section: a fold, closed unless the owner left it open. */
export function renderResources(s: ResState, open: boolean, now: number, hours: 6 | 24 = 6): string {
  return `<details class="fold res-fold"${open ? " open" : ""}><summary>리소스</summary><div class="res-body">${open ? renderResBody(s, now, hours) : ""}</div></details>`;
}
