// The worker's side of the panel: plugin.request handlers and status bar item B. Both forward to the
// core's PanelCore (through core-link.ts) and pass its answer back; nothing is counted or written here.
import type { PanelCore } from "../core-link.ts";
import { MAX_REAP } from "./resources.ts";

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

// REAPER's card instance ids; the panel sends back only ids a reading listed (decision 234).
const CARD = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_CARDS = MAX_REAP;

/** The confirmed 정리 a panel may ask for; anything else is refused before the core is touched. */
export function parseReap(raw: unknown): { worktrees: string[]; tmp: boolean } | null {
  const a = (raw ?? {}) as Record<string, unknown>;
  const ws = a.worktrees ?? [];
  if (!Array.isArray(ws) || ws.length > MAX_CARDS || !ws.every((w) => typeof w === "string" && CARD.test(w))) return null;
  if (a.tmp !== undefined && typeof a.tmp !== "boolean") return null;
  const tmp = a.tmp === true;
  if (ws.length === 0 && !tmp) return null;
  return { worktrees: [...new Set(ws as string[])], tmp };
}

function target(raw: unknown): { group?: string; item?: string } {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(typeof t.group === "string" && t.group !== "" ? { group: t.group } : {}),
    ...(typeof t.item === "string" && ITEM.test(t.item) ? { item: t.item } : {}),
  };
}

/** Status bar text when the core cannot answer: no number is guessed. */
export const STATUS_UNKNOWN: StatusItem = { text: "✨ SANGSOE | ?", tone: "neutral", tooltip: "sangsoe: 현황을 읽지 못함" };

// A group name goes into a shell command line, so only a plain token passes; anything else opens 현황.
const GROUP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The terminal command a header button may ask for; the panel's text never reaches the shell. */
export function openCommand(raw: unknown): string | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.view === "doctor") return "sangsoe doctor";
  if (o.view === "todo") return "sangsoe todo";
  if (o.view === "models") return "sangsoe models";
  if (o.view !== "brief") return null;
  const group = typeof o.group === "string" && GROUP.test(o.group) ? o.group : null;
  const item = group && typeof o.item === "string" && ITEM.test(o.item) ? o.item : null;
  return ["sangsoe brief", group, item].filter(Boolean).join(" ");
}

type Exec = (cmd: string, args: readonly string[]) => Promise<{ ok: boolean; code: string | number | null; out: string; err: string }>;

// Orca's worktree ids are `<repo-id>::<absolute path>`; anything else never reaches the command line.
const WORKTREE = /^[A-Za-z0-9-]+::\/\S.*$/;

/**
 * `panel.open`: Orca's own terminal (`orca terminal create`) runs the token-free CLI read, in the
 * worktree the core names by id. `active` would resolve from this worker's cwd, `/` (decision 198).
 */
export function openHandler(exec: Exec, worktreeOf: (target: { group?: string; item?: string }) => Promise<Reply>) {
  return async (input: unknown): Promise<Reply> => {
    const command = openCommand(input);
    if (!command) return refuse("bad_input", "not a panel view", "press a header button on the panel");
    const fix = `run ${command} in a terminal`;
    const o = (input ?? {}) as Record<string, unknown>;
    // The catalog belongs to no group, so it opens where the overview's brief opens (decision 200).
    const w =
      o.view === "brief" ? await worktreeOf(target(input)) : o.view === "models" ? await worktreeOf({}) : refuse("no_worktree", "this view has no worktree of its own", fix);
    if (!w.ok) return refuse(w.refusal.code, w.refusal.reason, fix);
    const id = (w.value as { worktree?: unknown }).worktree;
    if (typeof id !== "string" || !WORKTREE.test(id)) return refuse("no_worktree", "the core named no worktree", fix);
    const r = await exec("orca", ["terminal", "create", "--worktree", `id:${id}`, "--title", command, "--command", command, "--focus", "--json"]);
    if (r.ok) return { ok: true, value: { status: "opened" } };
    // Orca answers a failure with a JSON envelope on stdout; only its code goes on (decision 205).
    const code = orcaErrorCode(r.out);
    if (code === "selector_not_found") return refuse("no_worktree", "the worktree this item ran in is gone", fix);
    // Stdout never goes on: a reply cut short by the exec cap does not parse but still carries Orca's JSON.
    return refuse("open_failed", code ? `orca terminal create: ${code}` : (r.err || String(r.code)).slice(0, 200), fix);
  };
}

const CODE = /^[a-z_]{1,64}$/;

function orcaErrorCode(out: string): string | null {
  let code: unknown;
  try {
    code = (JSON.parse(out) as { error?: { code?: unknown } } | null)?.error?.code;
  } catch {
    code = /"code"\s*:\s*"([a-z_]{1,64})"/.exec(out)?.[1];
  }
  return typeof code === "string" && CODE.test(code) ? code : null;
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
    "panel.resources": async (input?: unknown): Promise<Reply> => {
      const part = (input as { part?: unknown } | null | undefined)?.part;
      if (part !== undefined && part !== "load" && part !== "made" && part !== "candidates") {
        return refuse("bad_input", "not a part of the 리소스 section", "refresh the 리소스 section");
      }
      try {
        const c = await core();
        if (!isCore(c)) return c;
        if (part) return c.resourcePart ? await c.resourcePart(part) : refuse("core_old", "this core reads the 리소스 section whole", "read it whole");
        return c.resources ? await c.resources() : refuse("core_old", "this core has no resource read", "update sangsoe");
      } catch (e) {
        return thrown(e);
      }
    },
    "panel.reap": async (input: unknown): Promise<Reply> => {
      const a = parseReap(input);
      if (!a) return refuse("bad_input", "not a cleanup the panel listed", "refresh the 리소스 section");
      try {
        const c = await core();
        if (!isCore(c)) return c;
        return c.reap ? await c.reap(a) : refuse("core_old", "this core has no cleanup", "update sangsoe");
      } catch (e) {
        return thrown(e);
      }
    },
    /** The worktree `panel.open` opens a terminal in; an older core without it names none. */
    worktree: async (t: { group?: string; item?: string }): Promise<Reply> => {
      try {
        const c = await core();
        if (!isCore(c)) return c;
        return c.worktree ? await c.worktree(t) : refuse("no_worktree", "this core names no worktree", "");
      } catch (e) {
        return thrown(e);
      }
    },
    /** Starts the core's store watch; resolves with its closer, or null when this core or store has none. */
    watch: async (onChange: (seq: number) => void): Promise<(() => void) | null> => {
      try {
        const c = await core();
        const w = isCore(c) ? c.watch?.(onChange) : undefined;
        return w?.ok ? () => w.value.close() : null;
      } catch {
        return null;
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
