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
export const STATUS_UNKNOWN: StatusItem = { text: "SANGSOE  ?", tone: "neutral", tooltip: "sangsoe: 현황을 읽지 못함" };

// A group name goes into a shell command line, so only a plain token passes; anything else opens 현황.
const GROUP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The terminal command a header button may ask for; the panel's text never reaches the shell. */
export function openCommand(raw: unknown): string | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.view === "doctor") return "sangsoe doctor";
  if (o.view === "todo") return "sangsoe todo";
  if (o.view !== "brief") return null;
  const group = typeof o.group === "string" && GROUP.test(o.group) ? o.group : null;
  const item = group && typeof o.item === "string" && ITEM.test(o.item) ? o.item : null;
  return ["sangsoe brief", group, item].filter(Boolean).join(" ");
}

type Exec = (cmd: string, args: readonly string[]) => Promise<{ ok: boolean; code: string | number | null; out: string; err: string }>;

/** `panel.open`: Orca's own terminal (`orca terminal create`) runs the token-free CLI read. */
export function openHandler(exec: Exec) {
  return async (input: unknown): Promise<Reply> => {
    const command = openCommand(input);
    if (!command) return refuse("bad_input", "not a panel view", "press a header button on the panel");
    const r = await exec("orca", ["terminal", "create", "--worktree", "active", "--title", command, "--command", command, "--focus", "--json"]);
    return r.ok ? { ok: true, value: { status: "opened" } } : refuse("open_failed", (r.err || r.out || String(r.code)).slice(0, 200), `run ${command} in a terminal`);
  };
}

const thrown = (e: unknown): Reply => refuse("core_error", e instanceof Error ? e.message : String(e), "reopen the panel; run sangsoe doctor if it repeats");

export function panelHandlers(load: () => Promise<PanelCore | string>) {
  let loaded: Promise<PanelCore | string> | null = null;
  const core = async (): Promise<PanelCore | Reply> => {
    loaded ??= load();
    const c = await loaded;
    if (typeof c !== "string") return c;
    loaded = null; // the next request tries again, e.g. after the build that was missing lands
    return refuse("core_unavailable", c, "run sangsoe doctor");
  };
  const isCore = (c: PanelCore | Reply): c is PanelCore => !("ok" in c);
  return {
    "panel.brief": async (input: unknown): Promise<Reply> => {
      try {
        const c = await core();
        return isCore(c) ? await c.brief(target(input)) : c;
      } catch (e) {
        return thrown(e);
      }
    },
    "panel.act": async (input: unknown): Promise<Reply> => {
      const a = parseAct(input);
      if (!a) return refuse("bad_input", "not a panel act", "press a button on the panel");
      try {
        const c = await core();
        return isCore(c) ? await c.act(a) : c;
      } catch (e) {
        return thrown(e);
      }
    },
    /** One status bar reading; the caller pushes it to statusBar.update. */
    status: async (): Promise<StatusItem> => {
      let r: Reply;
      try {
        const c = await core();
        r = isCore(c) ? await c.statusBar() : c;
      } catch (e) {
        r = thrown(e);
      }
      return r.ok ? (r.value as StatusItem) : { ...STATUS_UNKNOWN, tooltip: `sangsoe: ${r.refusal.reason}`.slice(0, 256) };
    },
  };
}
