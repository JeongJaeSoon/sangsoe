import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { done, type Result, refuse } from "../notify/result.ts";

export type OldItemStatus = "todo" | "doing" | "held";

export interface OldItem {
  readonly id: string;
  readonly status: OldItemStatus;
  readonly lane: string;
  readonly who: string | null;
  readonly title: string;
  readonly next: string | null;
  readonly note: string | null;
  readonly trig: string | null;
  readonly due: string | null;
  readonly afterRef: string | null;
  readonly program: string | null;
}

export interface OldDecision {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly link: string | null;
  /** Option labels, the recommended one first. */
  readonly options: readonly string[];
}

export interface OldState {
  readonly items: readonly OldItem[];
  readonly decisions: readonly OldDecision[];
  /** Read but not imported: closed records, and board rows and leads (they mirror Orca Runs and worktrees). */
  readonly skipped: { readonly closedItems: number; readonly closedDecisions: number; readonly boardRows: number; readonly leads: number };
}

const NEEDED_STEPS = ["4a-decisions", "4b-board"];
const FIX_PATH = "pass --from <path to agent-skills.db>";

/** Where agent-skills keeps its store: $ORCH_FLEET_STATE, else its default state folder. */
export function defaultOldStorePath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const dir = env.ORCH_FLEET_STATE ?? join(home, ".local", "state", "agent-skills", "dashboard");
  return join(dir.replace(/^~(?=\/|$)/, home), "agent-skills.db");
}

type Row = Record<string, string | number | null>;
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function labels(raw: unknown, recommend: unknown): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : "[]");
  } catch {
    parsed = [];
  }
  const all = (Array.isArray(parsed) ? parsed : [])
    .map((o) => (typeof o === "string" ? o : s((o as { label?: unknown })?.label)))
    .filter((l): l is string => l !== null);
  const i = typeof recommend === "number" ? recommend - 1 : -1;
  const rec = all[i];
  return rec === undefined ? all : [rec, ...all.filter((_, j) => j !== i)];
}

/** Reads agent-skills.db with SELECTs only; it never writes, and it refuses a store agent-skills itself would not read. */
export function readOldState(path: string): Result<OldState> {
  if (!existsSync(path)) return refuse("old_store_missing", `${path} does not exist`, FIX_PATH);
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (e) {
    return refuse("old_store_unreadable", `${path}: ${(e as Error).message}`, "close what holds it or check its permissions; nothing was read");
  }
  try {
    const all = (sql: string) => db.prepare(sql).all() as Row[];
    const count = (sql: string) => Number((db.prepare(sql).get() as Row | undefined)?.n ?? 0);
    const steps = new Set(all("SELECT step FROM migration").map((r) => String(r.step)));
    const missing = NEEDED_STEPS.filter((step) => !steps.has(step));
    if (missing.length > 0) {
      return refuse("old_store_not_migrated", `${path} has not recorded ${missing.join(", ")}`, "finish agent-skills' own `orch db import` first");
    }
    const items = all(
      "SELECT id, status, lane, who, title, next, note, trig, due, after_ref, program FROM item WHERE status IN ('todo','doing','held') ORDER BY created_at, id",
    ).map(
      (r): OldItem => ({
        id: String(r.id),
        status: r.status as OldItemStatus,
        lane: String(r.lane),
        who: s(r.who),
        title: String(r.title),
        next: s(r.next),
        note: s(r.note),
        trig: s(r.trig),
        due: s(r.due),
        afterRef: s(r.after_ref),
        program: s(r.program),
      }),
    );
    const decisions = all("SELECT id, title, body, link, options, recommend FROM decision WHERE status = 'open' ORDER BY created_at, id").map(
      (r): OldDecision => ({ id: String(r.id), title: String(r.title), body: s(r.body), link: s(r.link), options: labels(r.options, r.recommend) }),
    );
    return done({
      items,
      decisions,
      skipped: {
        closedItems: count("SELECT count(*) AS n FROM item WHERE status NOT IN ('todo','doing','held')"),
        closedDecisions: count("SELECT count(*) AS n FROM decision WHERE status <> 'open'"),
        boardRows: count("SELECT count(*) AS n FROM board_row WHERE done_at IS NULL"),
        leads: count("SELECT count(*) AS n FROM lead WHERE closed_at IS NULL"),
      },
    });
  } catch (e) {
    return refuse("old_store_unreadable", `${path}: ${(e as Error).message}`, "check that it is an agent-skills store at schema 2 or later");
  } finally {
    db.close();
  }
}
