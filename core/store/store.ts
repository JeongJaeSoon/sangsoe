import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ContractError,
  type Clock,
  canTransition,
  checkDedupeKey,
  type EventDef,
  type EventType,
  eventDef,
  isoUtc,
  type Needs,
  type PayloadOf,
  type StoredEvent,
  systemClock,
} from "../contract/index.ts";
import { checkLocalFs, checkSqliteVersion, type FsProbe, type StartCheck } from "./checks.ts";
import { DDL, SCHEMA_V } from "./schema.ts";

export type NewEvent<T extends EventType = EventType> = {
  [K in T]: {
    readonly type: K;
    readonly source: string;
    readonly payload: PayloadOf<K>;
    readonly target?: string;
    readonly subject?: string;
    readonly entity?: string;
    readonly entity_id?: string;
    readonly actor?: string;
    readonly needs?: Needs;
    readonly severity?: string;
    readonly dedupe_key?: string;
    readonly before?: unknown;
  };
}[T];

export interface Appended {
  readonly seq: number;
  /** false when a row with the same dedupe_key already existed; seq is then that row's. */
  readonly inserted: boolean;
}

export interface EventFilter {
  readonly type?: string;
  readonly afterSeq?: number;
}

export const REDACTED_MARK = "[지움]";

export class StartRefused extends Error {
  override name = "StartRefused";
  readonly checks: readonly StartCheck[];
  constructor(checks: readonly StartCheck[]) {
    super(
      checks
        .filter((c) => !c.ok)
        .map((c) => c.detail)
        .join("; "),
    );
    this.checks = checks;
  }
}

export interface OpenOptions {
  /** Database file, or ":memory:". Default ~/.local/share/sangsoe/sangsoe.db (decision 14). */
  readonly path?: string;
  readonly home?: string;
  readonly clock?: Clock;
  readonly fsProbe?: FsProbe;
}

export function defaultDbPath(home: string = homedir()): string {
  return join(home, ".local", "share", "sangsoe", "sangsoe.db");
}

type Row = Record<string, string | number | null>;

// Reads one row: upcasts the payload from the row's schema_v to its type's current version and
// validates it tolerantly. A type this build does not know (written by a newer one) passes through.
export function decodeRow(row: Row, lookup: (type: string) => EventDef | undefined = eventDef): StoredEvent {
  const type = String(row.type);
  const written = Number(row.schema_v);
  let payload = JSON.parse(String(row.after ?? "{}")) as Record<string, unknown>;
  const def = lookup(type);
  if (def) {
    for (let v = written; v < def.version; v++) {
      const step = def.upcast[v];
      if (!step) throw new ContractError(`${type}: no upcast from schema_v ${v}`);
      payload = step(payload);
    }
    def.payload(payload, type);
  }
  return {
    seq: Number(row.seq),
    ts: String(row.ts),
    type,
    source: String(row.source),
    target: row.target === null ? null : String(row.target),
    subject: row.subject === null ? null : String(row.subject),
    entity: row.entity === null ? null : String(row.entity),
    entity_id: row.entity_id === null ? null : String(row.entity_id),
    actor: row.actor === null ? null : String(row.actor),
    needs: String(row.needs) as Needs,
    severity: row.severity === null ? null : String(row.severity),
    dedupe_key: row.dedupe_key === null ? null : String(row.dedupe_key),
    schema_v: written,
    before: row.before === null ? null : JSON.parse(String(row.before)),
    payload,
  };
}

export class Store {
  readonly #db: DatabaseSync;
  readonly #clock: Clock;

  private constructor(db: DatabaseSync, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  /** Runs the start checks, then opens (creating if needed) the database. Refuses with StartRefused. */
  static open(opts: OpenOptions = {}): Store {
    const path = opts.path ?? defaultDbPath(opts.home);
    const checks: StartCheck[] = [];
    if (path !== ":memory:") {
      const fs = checkLocalFs(dirname(path), opts.fsProbe);
      checks.push(fs);
      if (!fs.ok) throw new StartRefused(checks);
      mkdirSync(dirname(path), { recursive: true });
    }
    const db = new DatabaseSync(path);
    const version = String((db.prepare("SELECT sqlite_version() AS v").get() as Row).v);
    checks.push(checkSqliteVersion(version));
    if (checks.some((c) => !c.ok)) {
      db.close();
      throw new StartRefused(checks);
    }
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    const store = new Store(db, opts.clock ?? systemClock);
    store.#migrate();
    return store;
  }

  #migrate(): void {
    this.#tx(() => {
      const has = this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migration'").get();
      if (!has) {
        this.#db.exec(DDL);
        this.#db
          .prepare("INSERT INTO migration (version, applied_at, note) VALUES (?, ?, ?)")
          .run(SCHEMA_V, this.#now(), "initial schema");
        return;
      }
      const v = this.schemaVersion();
      if (v > SCHEMA_V) throw new ContractError(`database schema ${v} is newer than this build (${SCHEMA_V})`);
    });
  }

  schemaVersion(): number {
    const row = this.#db.prepare("SELECT max(version) AS v FROM migration").get() as Row;
    return Number(row.v);
  }

  #now(): string {
    return isoUtc(this.#clock(), "clock");
  }

  #tx<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.#db.exec("COMMIT");
      return out;
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
  }

  #insert(e: NewEvent): Appended {
    const def = eventDef(e.type);
    if (!def) throw new ContractError(`unknown event type ${JSON.stringify(e.type)}`);
    def.payload(e.payload, e.type);
    if (e.dedupe_key !== undefined) checkDedupeKey(def, e.dedupe_key);
    if (e.type === "item_transition" && !canTransition(e.payload.from, e.payload.to)) {
      throw new ContractError(`item_transition ${e.payload.from} → ${e.payload.to} is not in the transition table`);
    }
    const row = this.#db
      .prepare(
        `INSERT INTO event (ts, type, source, target, subject, entity, entity_id, actor, needs, severity, dedupe_key, schema_v, before, after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (dedupe_key) DO NOTHING RETURNING seq`,
      )
      .get(
        this.#now(),
        e.type,
        e.source,
        e.target ?? null,
        e.subject ?? null,
        e.entity ?? null,
        e.entity_id ?? null,
        e.actor ?? null,
        e.needs ?? def.needs,
        e.severity ?? null,
        e.dedupe_key ?? null,
        def.version,
        e.before === undefined ? null : JSON.stringify(e.before),
        JSON.stringify(e.payload),
      ) as Row | undefined;
    if (row) return { seq: Number(row.seq), inserted: true };
    const existing = this.#db.prepare("SELECT seq FROM event WHERE dedupe_key = ?").get(e.dedupe_key ?? null) as Row;
    return { seq: Number(existing.seq), inserted: false };
  }

  append(e: NewEvent): Appended {
    return this.#tx(() => this.#insert(e));
  }

  /** Records an owner_action with its masked text (masking is the caller's, before this call). */
  appendOwnerAction(e: NewEvent<"owner_action">, maskedText: string): Appended {
    return this.#tx(() => {
      const out = this.#insert(e);
      if (out.inserted) this.#db.prepare("INSERT INTO owner_text (seq, text) VALUES (?, ?)").run(out.seq, maskedText);
      return out;
    });
  }

  /** `sangsoe owner-text redact`: empties one owner text and records why; summary, hash and class stay. */
  redactOwnerText(seq: number, by: { actor: string; reason: string }): Appended {
    return this.#tx(() => {
      const cur = this.#db.prepare("SELECT text FROM owner_text WHERE seq = ?").get(seq) as Row | undefined;
      if (!cur) throw new ContractError(`no owner text at seq ${seq}`);
      const out = this.#insert({
        type: "owner_text_redacted",
        source: "owner-text redact",
        actor: by.actor,
        subject: `owner_action:${seq}`,
        dedupe_key: `owner_text_redacted:${seq}`,
        payload: { seq, reason: by.reason },
      });
      if (cur.text !== null) this.#db.prepare("UPDATE owner_text SET text = NULL WHERE seq = ?").run(seq);
      return out;
    });
  }

  /** The owner text as views show it: REDACTED_MARK once emptied, undefined when there is none. */
  ownerText(seq: number): string | undefined {
    const row = this.#db.prepare("SELECT text FROM owner_text WHERE seq = ?").get(seq) as Row | undefined;
    if (!row) return undefined;
    return row.text === null ? REDACTED_MARK : String(row.text);
  }

  events(filter: EventFilter = {}): StoredEvent[] {
    const rows = this.#db
      .prepare("SELECT * FROM event WHERE seq > ? AND (? IS NULL OR type = ?) ORDER BY seq")
      .all(filter.afterSeq ?? 0, filter.type ?? null, filter.type ?? null) as Row[];
    return rows.map((r) => decodeRow(r));
  }

  /** Issues the next iNNN / dNNN; a number is never reused (appendix #schema "번호"). */
  allocate(kind: "i" | "d"): string {
    return this.#tx(() => {
      const row = this.#db
        .prepare(
          "INSERT INTO counter (name, last) VALUES (?, 1) ON CONFLICT (name) DO UPDATE SET last = last + 1 RETURNING last",
        )
        .get(kind) as Row;
      return `${kind}${String(row.last).padStart(3, "0")}`;
    });
  }

  close(): void {
    this.#db.close();
  }
}
