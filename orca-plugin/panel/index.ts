/// <reference lib="dom" />
// The sangsoe html panel (decision 92): three stages down and back, decision and 완료 buttons. Every
// button is a plugin.request to the worker, which calls the core; the panel changes nothing itself.
import { foldReads, panelReads, tickParts } from "./refresh.ts";
import {
  changedPieces,
  FOCUS_AFTER,
  joinPieces,
  PARTS,
  type PartName,
  PIECES,
  type Pieces,
  patchPieces,
  type Reaped,
  RES_OPEN_KEY,
  type ResState,
  readParts,
  reapTargets,
  renderResBody,
  renderResources,
  repaint,
  resPieces,
  STALE_MS,
  type Want,
} from "./resources.ts";
import { STYLE } from "./style.ts";
import {
  type Act,
  type Acted,
  actedNote,
  autoRefresh,
  back,
  current,
  down,
  errorNote,
  type Open,
  openTarget,
  type PanelView,
  prunePending,
  type Refusal,
  renderError,
  renderStage,
  screenMemo,
  TABS,
  type Tab,
  type Target,
  trail,
} from "./view.ts";

type Frame = {
  plugin: {
    request(name: string, input?: unknown): Promise<unknown>;
    /** The worker's `panels.post`; absent on an Orca without it. */
    on?(event: string, fn: (payload: unknown) => void): unknown;
  };
  /** The plugin's own store (`storage:own`); absent on an Orca without it, where the fold opens closed. */
  storage?: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
};
declare const orca: Frame;

type Reply<T> = { ok: true; value: T } | { ok: false; refusal: { code: string; reason: string; fix: string } };

type RootDoc = { getElementById(id: string): HTMLElement | null; createElement(tag: "div"): HTMLElement; body: { append(e: HTMLElement): void } };

/**
 * Orca's generated page for a .ts entry already holds `<div id="root">` (decision 225 (1)): a second
 * one appended after it left the first empty, padded by #root's own bottom space above the header.
 */
export function panelRoot(doc: RootDoc): HTMLElement {
  const own = doc.getElementById("root");
  if (own) return own;
  const root = doc.createElement("div");
  root.id = "root";
  doc.body.append(root);
  return root;
}

/**
 * The 리소스 fold (decision 234) in its own element after #root, so the panel's own repaints never
 * reach it. It reads when opened, shown again or refreshed, and on the panel's interval tick while
 * open and shown (decision 257); 정리 runs on the confirm button alone. Returns what that tick calls.
 */
function mountResources(after: HTMLElement): () => void {
  const box = document.createElement("section");
  box.id = "res";
  after.after(box);
  let state: ResState = { kind: "idle" };
  let open = false;
  let hours: 6 | 24 = 6;
  /** What the body shows now, piece by piece; null when it was drawn some other way. */
  let drawn: Pieces | null = null;
  const draw = () => {
    box.innerHTML = renderResources(state, open, Date.now(), hours);
    drawn = null;
  };
  let want: Want | null = null;
  // A click anywhere else drops a press still waiting for its button.
  document.addEventListener("pointerdown", (ev) => {
    if (!box.contains(ev.target as Node)) want = null;
  });
  const body = () => {
    const el = box.querySelector<HTMLElement>(".res-body");
    if (!el) return;
    drawn = state.kind === "shown" || state.kind === "reading" ? resPieces(state, Date.now(), hours) : null;
    want = repaint(el, drawn ? joinPieces(drawn) : renderResBody(state, Date.now(), hours), document.activeElement, want);
  };
  const failed = (e: unknown) => ({ ok: false as const, refusal: { code: "request_failed", reason: String(e), fix: "reopen the panel" } });
  const ask = (input?: { part: PartName }) => orca.plugin.request("panel.resources", input);
  // One read at a time, whoever asks (decision 257).
  let flight: Promise<void> | null = null;
  const solo = (fn: () => Promise<void>): Promise<void> => {
    const p: Promise<void> = fn().finally(() => {
      if (flight === p) flight = null;
    });
    flight = p;
    return p;
  };
  /** When the 정리 후보 now shown was asked for; only an answer that was read and applied moves it. */
  let candidatesAt = Number.NEGATIVE_INFINITY;
  // Decision 235: three parts asked together, each painted as it comes. A read the owner asks for
  // shows its reading row at once and starts when a tick's read still running has ended.
  const read = async (result?: Reaped) => {
    const last = state.kind === "shown" ? state.view : undefined;
    state = { kind: "reading", got: {}, last, result };
    body();
    while (flight) await flight.catch(() => undefined);
    await solo(async () => {
      const asked = Date.now();
      const end = await readParts(ask, (s) => {
        state = s.kind === "reading" ? { ...s, last, result } : s;
        body();
      });
      if (end.kind === "shown" && end.got?.candidates.ok) candidatesAt = asked;
      state = end.kind === "shown" && result ? { ...end, result } : end;
      body();
    });
  };
  /**
   * Decision 257: the read on the panel's interval tick, and the one on showing the section again.
   * Nothing says it is reading; its answer rewrites only the pieces whose html changed, and is
   * dropped if the owner opened the confirm list, started 정리 or asked for a read meanwhile. #res
   * keeps what the last tick's read cost (data-tick-ms, -parts, -paint) for panel-measure.
   */
  const quiet = async (why: "show" | "tick") => {
    if (state.kind !== "shown") return;
    // A view read whole (a core older than decision 235) cannot be read in parts: a tick would read
    // 정리 후보 every time, so it waits for show, open or 새로 고침 as before.
    if (why === "tick" && !state.got) return;
    const t0 = performance.now();
    const asked = Date.now();
    const kept = state.got;
    const parts = why === "show" || !kept ? PARTS : tickParts(asked, candidatesAt);
    const end = await readParts(ask, () => undefined, { parts, kept });
    const s = state;
    if (s.kind !== "shown" || s.confirm || s.running) return;
    if (end.kind === "shown") {
      state = s.result ? { ...end, result: s.result } : end;
      // A 정리 후보 that failed keeps the kept answer: the next tick asks again.
      const c = end.got?.candidates;
      if (parts.includes("candidates") && c?.ok && c !== kept?.candidates) candidatesAt = asked;
    }
    const el = box.querySelector<HTMLElement>(".res-body");
    if (!el) return;
    const next = resPieces(state as Extract<ResState, { kind: "shown" }>, Date.now(), hours);
    const which = drawn ? changedPieces(drawn, next) : PIECES;
    patchPieces(el, next, which, document.activeElement);
    drawn = next;
    if (why !== "tick") return;
    box.dataset.tickMs = String(Math.round(performance.now() - t0));
    box.dataset.tickParts = parts.join("+");
    box.dataset.tickPaint = which.length === 0 ? "none" : which.join("+");
  };
  const loop = foldReads({
    read: (why) => solo(() => quiet(why)),
    may: () => !flight && state.kind === "shown" && !state.confirm && !state.running,
    shown: () => open && document.visibilityState === "visible",
  });
  document.addEventListener("visibilitychange", loop.sync);
  const run = async () => {
    if (state.kind !== "shown" || state.running) return;
    const view = state.view;
    if (Date.now() - Date.parse(view.at) > STALE_MS) return read();
    state = { ...state, running: true };
    body();
    const r = (await orca.plugin.request("panel.reap", reapTargets(view)).catch(failed)) as Reply<Reaped>;
    if (r.ok) await read(r.value);
    else state = { kind: "failed", refusal: r.refusal };
    body();
  };
  box.addEventListener("toggle", (ev) => {
    const d = ev.target as HTMLDetailsElement;
    if (!d.matches(".res-fold")) return;
    open = d.open;
    void orca.storage?.set(RES_OPEN_KEY, open).catch(() => undefined);
    if (open && (state.kind === "idle" || state.kind === "failed")) void read();
    else body();
    loop.sync();
  }, true);
  box.addEventListener("click", (ev) => {
    const el = (ev.target as Element).closest<HTMLElement>("[data-res]");
    if (!el) return;
    const what = el.getAttribute("data-res");
    want = what ? { from: what, to: FOCUS_AFTER[what] ?? what } : null;
    const busy = state.kind === "reading" || (state.kind === "shown" && state.running === true);
    const stale = state.kind === "shown" && Date.now() - Date.parse(state.view.at) > STALE_MS;
    if (what === "ask" && stale) {
      // A view gone stale since it was drawn: read it again, as 정리 itself would.
      want = { from: what, to: "refresh" };
      if (!busy) void read();
    } else if (what === "refresh") {
      if (!busy) void read();
    } else if (what === "h6" || what === "h24") {
      hours = what === "h6" ? 6 : 24;
      body();
    }
    else if (what === "run") void run();
    else if (state.kind === "shown" && (what === "ask" || what === "cancel")) {
      state = { ...state, confirm: what === "ask" };
      body();
    }
  });
  draw();
  void (orca.storage?.get(RES_OPEN_KEY) ?? Promise.resolve(null))
    .catch(() => null)
    .then((v) => {
      if (v !== true) return;
      open = true;
      draw();
      void read();
      loop.sync();
    });
  return loop.tick;
}

function mount(): void {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const root = panelRoot(document);
  const resTick = mountResources(root);

  let stack: Target[] = [];
  let tab: Tab = "all";
  let note = "";
  let busy = false;
  const where = (): Target => openTarget(stack);

  const esc = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const failed = (e: unknown) => ({ ok: false as const, refusal: { code: "request_failed", reason: String(e), fix: "reopen the panel" } });
  const say = (text: string) => {
    note = text ? `<p class="msg" role="status">${esc(text)}</p>` : "";
  };
  const sayRefused = (r: Refusal) => {
    note = errorNote(r);
  };
  // Owner items this panel pressed into ⏳ 검증 대기: their 완료 stays off until a reading drops them.
  const pending = new Set<string>();
  let lastOk = false;
  // Readings now arrive every few seconds (decision 205): a reply older than the newest asked-for
  // reading is dropped, so it cannot paint the stage the owner just left, and an unchanged page is
  // not rewritten, so an opened fold, the menu and focus stay.
  let asked = 0;
  let painted = "";
  const memo = screenMemo();
  const paint = (r: Reply<PanelView>) => {
    // The message sits under the header row, above the tabs or the back line.
    const html = r.ok ? renderStage(r.value, tab, where(), pending) : renderError(r.refusal, trail(stack), where());
    const page = html.replace("</header>", () => `</header>${note}`);
    if (page === painted) return;
    root.innerHTML = page;
    painted = page;
  };
  const draw = async (auto = false) => {
    const n = ++asked;
    const at = current(stack);
    const r = (await orca.plugin.request("panel.brief", { ...at, ...(auto ? { auto: true } : {}) }).catch(failed)) as Reply<PanelView>;
    if (n !== asked) return;
    lastOk = r.ok;
    if (r.ok) {
      prunePending(pending, r.value.todo);
      memo.put(at, r.value, stack);
    }
    paint(r);
  };
  // A screen read before paints from memory at once; the reading after it repaints what changed.
  const go = () => {
    const known = memo.get(current(stack));
    if (known) paint({ ok: true, value: known });
    void draw();
  };
  const closeMenu = () => root.querySelector("details.menu")?.removeAttribute("open");
  const open = async (o: Open) => {
    closeMenu();
    const r = (await orca.plugin.request("panel.open", o).catch(failed)) as Reply<{ status: string }>;
    const stale = note !== "";
    if (r.ok) say("");
    else sayRefused(r.refusal);
    if (!r.ok || stale) await draw();
  };
  // Decisions 198, 205: the panel re-reads a few seconds after the worker's store.changed push, when
  // it is shown again, and on the status bar's interval; a failed reading waits for 새로 고침.
  const reads = panelReads({
    read: () => draw(true),
    tick: resTick,
    may: () => {
      const formOpen = [...root.querySelectorAll<HTMLElement>("tr.other")].some((f) => !f.hidden);
      return autoRefresh({ visible: document.visibilityState === "visible", lastOk, busy, formOpen });
    },
  });
  orca.plugin.on?.("store.changed", reads.changed);
  document.addEventListener("visibilitychange", reads.changed);
  document.addEventListener("click", (ev) => {
    if (!(ev.target as Element).closest("details.menu")) closeMenu();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeMenu();
  });
  // One act at a time: a second click while the first is in flight would answer the decision twice.
  const act = async (a: Act) => {
    if (busy) return;
    busy = true;
    painted = "";
    for (const b of root.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
    try {
      const r = (await orca.plugin.request("panel.act", a).catch(failed)) as Reply<Acted>;
      if (r.ok) say(actedNote(a, r.value));
      else sayRefused(r.refusal);
      if (r.ok && a.kind === "done" && r.value.status === "pending_verify") pending.add(a.item);
      await draw();
    } finally {
      busy = false;
    }
  };

  root.addEventListener("click", (ev) => {
    const el = (ev.target as Element).closest("[data-act],[data-other],[data-back],[data-nav],[data-refresh],[data-open],[data-tab-to]");
    if (!el || (ev.target as Element).closest("a")) return;
    if (el.hasAttribute("data-refresh")) {
      say("");
      void draw();
    } else if (el.hasAttribute("data-open")) {
      void open(JSON.parse(el.getAttribute("data-open") ?? "{}") as Open);
    } else if (el.hasAttribute("data-tab-to")) {
      const t = el.getAttribute("data-tab-to") as Tab;
      if (!TABS.includes(t)) return;
      tab = t;
      root.querySelector("main")?.setAttribute("data-view", t);
      for (const b of root.querySelectorAll("[data-tab-to]")) b.setAttribute("aria-selected", String(b === el));
    } else if (el.hasAttribute("data-back")) {
      stack = back(stack);
      say("");
      go();
    } else if (el.hasAttribute("data-act")) {
      void act(JSON.parse(el.getAttribute("data-act") ?? "{}") as Act);
    } else if (el.hasAttribute("data-other")) {
      const form = root.querySelector<HTMLElement>(`tr.other[data-for="${el.getAttribute("data-other")}"]`);
      if (form) form.hidden = !form.hidden;
    } else {
      const t = JSON.parse(el.getAttribute("data-nav") ?? "{}") as Target;
      stack = down(stack, t);
      say("");
      go();
    }
  });
  root.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.target as Element).matches("tr[data-nav]")) (ev.target as HTMLElement).click();
  });
  root.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    const text = (new FormData(form).get("text") ?? "").toString().trim();
    const decision = form.getAttribute("data-answer") ?? "";
    if (text) void act({ kind: "answer", decision, text });
  });
  void draw();
}

if (typeof document !== "undefined") mount();
