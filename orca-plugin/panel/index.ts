/// <reference lib="dom" />
// The sangsoe html panel (decision 92): three stages down and back, decision and 완료 buttons. Every
// button is a plugin.request to the worker, which calls the core; the panel changes nothing itself.
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
  type PanelView,
  REFRESH_MS,
  type Refusal,
  renderError,
  renderStage,
  TABS,
  type Tab,
  type Target,
  trail,
} from "./view.ts";

type Frame = { plugin: { request(name: string, input?: unknown): Promise<unknown> } };
declare const orca: Frame;

type Reply<T> = { ok: true; value: T } | { ok: false; refusal: { code: string; reason: string; fix: string } };

function mount(): void {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);

  let stack: Target[] = [];
  let tab: Tab = "all";
  let note = "";
  let busy = false;
  // The terminal's `sangsoe brief` takes `<group> [<iNNN>]`: the item's group is the one above it.
  const where = (): Target => {
    const group = [...stack].reverse().find((t) => t.group)?.group;
    const item = current(stack).item;
    return { ...(group ? { group } : {}), ...(group && item ? { item } : {}) };
  };

  const esc = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const failed = (e: unknown) => ({ ok: false as const, refusal: { code: "request_failed", reason: String(e), fix: "reopen the panel" } });
  const say = (text: string) => {
    note = text ? `<p class="msg" role="status">${esc(text)}</p>` : "";
  };
  const sayRefused = (r: Refusal) => {
    note = errorNote(r);
  };
  // Owner items this panel pressed into ⏳ 검증 대기: their 완료 stays off while a reading still lists them.
  const pending = new Set<string>();
  let lastOk = false;
  const draw = async (auto = false) => {
    const r = (await orca.plugin.request("panel.brief", { ...current(stack), ...(auto ? { auto: true } : {}) }).catch(failed)) as Reply<PanelView>;
    lastOk = r.ok;
    // The message sits under the header row, above the tabs or the back line.
    const html = r.ok ? renderStage(r.value, trail(stack), tab, where(), pending) : renderError(r.refusal, trail(stack), where());
    root.innerHTML = html.replace("</header>", () => `</header>${note}`);
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
  // Decision 198: the panel re-reads on the status bar's interval and when it is shown again, so its
  // band and status bar B read the same moment; a failed reading waits for 새로 고침.
  const tick = () => {
    const formOpen = [...root.querySelectorAll<HTMLElement>("tr.other")].some((f) => !f.hidden);
    if (autoRefresh({ visible: document.visibilityState === "visible", lastOk, busy, formOpen })) void draw(true);
  };
  setInterval(tick, REFRESH_MS);
  document.addEventListener("visibilitychange", tick);
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
      void draw();
    } else if (el.hasAttribute("data-act")) {
      void act(JSON.parse(el.getAttribute("data-act") ?? "{}") as Act);
    } else if (el.hasAttribute("data-other")) {
      const form = root.querySelector<HTMLElement>(`tr.other[data-for="${el.getAttribute("data-other")}"]`);
      if (form) form.hidden = !form.hidden;
    } else {
      const t = JSON.parse(el.getAttribute("data-nav") ?? "{}") as Target;
      stack = down(stack, t);
      say("");
      void draw();
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
