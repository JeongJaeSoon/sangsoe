// The worker's side of the panel: plugin.request handlers and status bar item B. Both forward to the
// core's PanelCore (through core-link.ts) and pass its answer back; nothing is counted or written here.
import type { PanelCore } from "../core-link.ts";

type Reply = { ok: true; value: unknown } | { ok: false; refusal: { code: string; reason: string; fix: string } };
export type StatusItem = { text: string; tone: "neutral" | "danger"; tooltip: string };

const refuse = (code: string, reason: string, fix: string): Reply => ({ ok: false, refusal: { code, reason, fix } });
const DECISION = /^d\d{3,}$/;
const ITEM = /^i\d{3,}$/;

/** The three acts a panel button may ask for; anything else is refused before the core is touched. */
export function parseAct(raw: unknown): { kind: "answer"; decision: string; choice: "recommended" } | { kind: "answer"; decision: string; text: string } | { kind: "done"; item: string } | null {
  const a = (raw ?? {}) as Record<string, unknown>;
  if (a.kind === "done" && typeof a.item === "string" && ITEM.test(a.item)) return { kind: "done", item: a.item };
  if (a.kind !== "answer" || typeof a.decision !== "string" || !DECISION.test(a.decision)) return null;
  if (a.choice === "recommended") return { kind: "answer", decision: a.decision, choice: "recommended" };
  if (typeof a.text === "string" && a.text.trim() !== "") return { kind: "answer", decision: a.decision, text: a.text.trim() };
  return null;
}

function target(raw: unknown): { group?: string; item?: string } {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(typeof t.group === "string" && t.group !== "" ? { group: t.group } : {}),
    ...(typeof t.item === "string" && ITEM.test(t.item) ? { item: t.item } : {}),
  };
}

/** Status bar text when the core cannot answer: no number is guessed. */
export const STATUS_UNKNOWN: StatusItem = { text: "sangsoe ?", tone: "neutral", tooltip: "sangsoe: 현황을 읽지 못함" };

export function panelHandlers(load: () => Promise<PanelCore | string>) {
  let loaded: Promise<PanelCore | string> | null = null;
  const core = async (): Promise<PanelCore | Reply> => {
    loaded ??= load();
    const c = await loaded;
    return typeof c === "string" ? refuse("core_unavailable", c, "run sangsoe doctor") : c;
  };
  const isCore = (c: PanelCore | Reply): c is PanelCore => !("ok" in c);
  return {
    "panel.brief": async (input: unknown): Promise<Reply> => {
      const c = await core();
      return isCore(c) ? c.brief(target(input)) : c;
    },
    "panel.act": async (input: unknown): Promise<Reply> => {
      const a = parseAct(input);
      if (!a) return refuse("bad_input", "not a panel act", "press a button on the panel");
      const c = await core();
      return isCore(c) ? c.act(a) : c;
    },
    /** One status bar reading; the caller pushes it to statusBar.update. */
    status: async (): Promise<StatusItem> => {
      const c = await core();
      if (!isCore(c)) return { ...STATUS_UNKNOWN, tooltip: `sangsoe: ${c.ok ? "" : c.refusal.reason}`.slice(0, 256) };
      const r = await c.statusBar();
      return r.ok ? r.value : { ...STATUS_UNKNOWN, tooltip: `sangsoe: ${r.refusal.reason}`.slice(0, 256) };
    },
  };
}
