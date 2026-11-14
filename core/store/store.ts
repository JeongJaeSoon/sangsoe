import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
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
import { appendLines, backupPath, isOwnRow, type Line, lastRowSeq, OWN_ROW_SQL, readBackup } from "./backup.ts";
import { checkLocalFs, checkSqliteVersion, type FsProbe, type StartCheck } from "./checks.ts";
import { readSamples, type SampleReads, type StoredSample, writeSample } from "./samples.ts";
import { DDL, EDGE_TRIGGERS, LOAD_SAMPLE_DDL, SCHEMA_V } from "./schema.ts";

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
  };
}[T];

/** Types written only by their own Store method (EventDef.storeOnly); Store.append's type leaves them out. */
export type StoreOnlyType = "owner_action" | "owner_text_redacted";

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

/** A write on a connection whose file is no longer the one at its path (decision 191). */
export class StoreReplaced extends Error {
  override name = "StoreReplaced";
}

export interface OpenOptions {
  /** Database file, or ":memory:". Default ~/.local/share/sangsoe/sangsoe.db (decision 14). */
  readonly path?: string;
  readonly home?: string;
  readonly clock?: Clock;
  readonly fsProbe?: FsProbe;
  /** How long an open waits on another connection's lock. Default 5000 ms. */
  readonly busyTimeoutMs?: number;
}

export function defaultDbPath(home: string = homedir()): string {
  return join(home, ".local", "share", "sangsoe", "sangsoe.db");
}

/** What an open that found the database lost or unreadable did (decisions 182-184). */
export type Rebuilt = {
  /** Own rows read back from the backup file. */
  restored: number;
  /** What could not be restored, by name; doctor prints this list. */
  lost: string[];
  /** Files moved aside instead of deleted. */
  setAside: string[];
};

/** The joiner of `signal{kind: store_rebuilt}.reason`, whose parts are the `lost` names. */
export const LOST_SEPARATOR = " | ";

// Host rows come back through the readers, which see only this much of the past (core/detect/pr/round.ts
// CLOSED_PAGE, core/detect/orca/round.ts GLOBAL_PAGES).
export const HOST_WINDOW_LOST =
  "host rows outside the readers' window: pr rows of PRs past each repository's 30 most recently closed and of every PR closed without a merge, main CI rows of all but each repository's newest merge, and Dispatches past worker-list's first 3 pages";

type Row = Record<string, string | number | null>;

const MAX_SEQ = Number.MAX_SAFE_INTEGER;

// SQLITE_CORRUPT and SQLITE_NOTADB. Any other error (a lock held by another opener) is rethrown,
// so a live database is never moved aside.
const DAMAGED = new Set([11, 26]);

/** A damaged file can open and fail only on its first read. */
function readable(db: DatabaseSync): boolean {
  try {
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    return true;
  } catch (e) {
    if (DAMAGED.has(Number((e as { errcode?: number }).errcode) & 0xff)) return false;
    db.close();
    throw e;
  }
}

/** Renames the files that exist to `<file>.<why>-<stamp>`; nothing is deleted. */
function moveAside(path: string, suffixes: readonly string[], why: string, clock: Clock): string[] {
  const stamp = isoUtc(clock(), "clock").replace(/[-:.]/g, "");
  const moved: string[] = [];
  for (const s of suffixes) {
    const from = `${path}${s}`;
    if (!existsSync(from)) continue;
    const to = `${from}.${why}-${stamp}`;
    renameSync(from, to);
    moved.push(to);
  }
  return moved;
}

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
  /** The own-facts file; null for ":memory:". */
  readonly #backup: string | null;
  /** The path and the file identity this connection opened; null for ":memory:". */
  readonly #file: { path: string; dev: number; ino: number } | null;
  /** Set when this open found the database lost or unreadable and rebuilt it; null otherwise. */
  rebuilt: Rebuilt | null = null;

  private constructor(db: DatabaseSync, clock: Clock, backup: string | null, path: string) {
    this.#db = db;
    this.#clock = clock;
    this.#backup = backup;
    if (path === ":memory:") this.#file = null;
    else {
      const { dev, ino } = statSync(path);
      this.#file = { path, dev, ino };
    }
  }

  /**
   * True once the file at this store's path is not the one it opened: moved aside, removed, or
   * rebuilt by another opener. Its rows would then reach no reader, so it refuses to write
   * (StoreReplaced) and a long-lived holder opens again (decision 191).
   */
  replaced(): boolean {
    if (!this.#file) return false;
    try {
      const now = statSync(this.#file.path);
      return now.dev !== this.#file.dev || now.ino !== this.#file.ino;
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return true;
      throw e;
    }
  }

  /** Runs the start checks, then opens (creating if needed) the database. Refuses with StartRefused. */
  static open(opts: OpenOptions = {}): Store {
    const path = opts.path ?? defaultDbPath(opts.home);
    const clock = opts.clock ?? systemClock;
    const checks: StartCheck[] = [];
    const setAside: string[] = [];
    let fresh = false;
    if (path !== ":memory:") {
      const fs = checkLocalFs(path, opts.fsProbe);
      checks.push(fs);
      if (!fs.ok) throw new StartRefused(checks);
      mkdirSync(dirname(path), { recursive: true });
      fresh = !existsSync(path);
      // A -wal left by a lost database must not be replayed into the new one.
      if (fresh) setAside.push(...moveAside(path, ["-wal", "-shm"], "orphan", clock));
    }
    const timeout = opts.busyTimeoutMs ?? 5000;
    let db = new DatabaseSync(path, { timeout });
    if (path !== ":memory:" && !fresh && !readable(db)) {
      db.close();
      setAside.push(...moveAside(path, ["", "-wal", "-shm"], "unreadable", clock));
      fresh = true;
      db = new DatabaseSync(path, { timeout });
    }
    const version = String((db.prepare("SELECT sqlite_version() AS v").get() as Row).v);
    checks.push(checkSqliteVersion(version));
    if (checks.some((c) => !c.ok)) {
      db.close();
      throw new StartRefused(checks);
    }
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    const backup = path === ":memory:" ? null : backupPath(path);
    const store = new Store(db, clock, backup, path);
    store.#migrate();
    if (backup && fresh && existsSync(backup)) store.rebuilt = store.#restore(backup, setAside);
    else if (backup) {
      if (store.#uncopied(backup, MAX_SEQ).length > 0) store.#tx(() => appendLines(backup, store.#uncopied(backup, MAX_SEQ)));
      // An empty file still marks the database as one whose loss is rebuilt, not started over.
      writeFileSync(backup, "", { flag: "a" });
    }
    return store;
  }

  /**
   * Reads the own facts back into a database found lost, keeping each row's seq (rows point at each
   * other by seq), then records what could not come back. Another process that restored first wins.
   */
  #restore(backup: string, setAside: string[]): Rebuilt | null {
    return this.#tx(() => {
      if (this.#db.prepare("SELECT 1 FROM event LIMIT 1").get()) return null;
      const read = readBackup(backup);
      const cols = ["seq", "ts", "type", "source", "target", "subject", "entity", "entity_id", "actor", "needs", "severity", "dedupe_key", "schema_v", "before", "after"];
      const insert = this.#db.prepare(`INSERT INTO event (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
      const lost = [...read.skipped];
      let restored = 0;
      for (const r of read.rows) {
        if (!isOwnRow(String(r.type), String(r.source))) {
          lost.push(`backup seq ${r.seq}: ${r.type} is not an own fact`);
          continue;
        }
        try {
          insert.run(...cols.map((c) => r[c] ?? null));
          restored++;
        } catch (e) {
          lost.push(`backup seq ${r.seq} (${r.type}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      for (const [name, last] of read.counters) {
        this.#db.prepare("INSERT INTO counter (name, last) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET last = max(last, excluded.last)").run(name, last);
      }
      const texts = Number((this.#db.prepare("SELECT count(*) AS n FROM event WHERE type = 'owner_action'").get() as Row).n);
      if (texts > 0) lost.push(`owner_text: the masked text of ${texts} owner_action row(s), never copied (decision 183)`);
      lost.push(HOST_WINDOW_LOST);
      this.#insert({
        type: "signal",
        source: "store",
        payload: { kind: "store_rebuilt", reason: lost.join(LOST_SEPARATOR) },
      });
      return { restored, lost, setAside };
    });
  }

  /**
   * The lines the facts file lacks below `below`: every own row past its last row line, then the
   * issued numbers. That is all of them for a database written before decision 182 (no file), and
   * after that the rows an older build wrote with no copy (decision 192). Exact only under the write
   * lock, where no other store is appending.
   */
  #uncopied(backup: string, below: number): Line[] {
    const last = lastRowSeq(backup);
    const rows = this.#db.prepare(`SELECT * FROM event WHERE seq > ? AND seq < ? AND ${OWN_ROW_SQL} ORDER BY seq`).all(last ?? 0, below) as Row[];
    if (rows.length === 0 && last !== undefined) return [];
    const counters = this.#db.prepare("SELECT name, last FROM counter").all() as Row[];
    return [...rows.map((row) => ({ row })), ...counters.map((c) => ({ counter: String(c.name), last: Number(c.last) }))];
  }

  #migrate(): void {
    this.#tx(() => {
      const has = this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migration'").get();
      let at: string | undefined;
      const mark = (version: number, note: string) => {
        at ??= this.#now();
        this.#db.prepare("INSERT INTO migration (version, applied_at, note) VALUES (?, ?, ?)").run(version, at, note);
      };
      if (!has) {
        this.#db.exec(DDL);
        mark(1, "initial schema");
      }
      const v = this.schemaVersion();
      if (v > SCHEMA_V) throw new ContractError(`database schema ${v} is newer than this build (${SCHEMA_V})`);
      if (v < 2) {
        this.#db.exec(EDGE_TRIGGERS);
        mark(2, "edge triggers: edge_source_graph, edge_no_cycle");
      }
      if (v < 3) {
        this.#db.exec(LOAD_SAMPLE_DDL);
        mark(3, "load_sample: 24h of resource-round samples");
      }
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
    if (this.replaced()) throw new StoreReplaced(`${this.#file?.path} is no longer the file this connection opened: open the store again`);
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

  #insert(e: NewEvent, viaStoreMethod = false): Appended {
    const def = eventDef(e.type);
    if (!def) throw new ContractError(`unknown event type ${JSON.stringify(e.type)}`);
    if (def.storeOnly && !viaStoreMethod) {
      throw new ContractError(`${e.type} is written only by its Store method, never by append`);
    }
    if (def.sources && !def.sources.includes(e.source)) {
      throw new ContractError(`${e.type} may be written only by ${def.sources.join(", ")}, not ${e.source}`);
    }
    def.payload(e.payload, e.type);
    const extra = Object.keys(e.payload).filter((k) => !def.fields.includes(k));
    if (extra.length > 0) throw new ContractError(`${e.type}: unknown payload field(s) ${extra.join(", ")}`);
    if (e.dedupe_key !== undefined) checkDedupeKey(def, e.dedupe_key, e.payload, { target: e.target });
    else if (def.dedupeRequired) throw new ContractError(`${e.type} needs a dedupe_key`);
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
        null,
        JSON.stringify(e.payload),
      ) as Row | undefined;
    if (row) {
      // Before COMMIT: a fact whose copy cannot be written is rolled back with it.
      if (this.#backup && isOwnRow(e.type, e.source)) {
        // Again under the lock: the file may have been rebuilt while BEGIN waited.
        if (this.replaced()) throw new StoreReplaced(`${this.#file?.path} was replaced during this write: open the store again`);
        const seq = Number(row.seq);
        appendLines(this.#backup, [...this.#uncopied(this.#backup, seq), { row: this.#db.prepare("SELECT * FROM event WHERE seq = ?").get(seq) as Row }]);
      }
      return { seq: Number(row.seq), inserted: true };
    }
    const existing = this.#db.prepare("SELECT seq FROM event WHERE dedupe_key = ?").get(e.dedupe_key ?? null) as Row;
    return { seq: Number(existing.seq), inserted: false };
  }

  append(e: NewEvent<Exclude<EventType, StoreOnlyType>>): Appended {
    return this.#tx(() => this.#insert(e));
  }

  /** Records an owner_action with its masked text (masking is the caller's, before this call). */
  appendOwnerAction(e: NewEvent<"owner_action">, maskedText: string): Appended {
    if (typeof maskedText !== "string" || maskedText.length === 0) {
      throw new ContractError("owner text: expected a non-empty string");
    }
    return this.#tx(() => {
      const out = this.#insert(e, true);
      if (out.inserted) this.#db.prepare("INSERT INTO owner_text (seq, text) VALUES (?, ?)").run(out.seq, maskedText);
      return out;
    });
  }

  /** `sangsoe owner-text redact`: empties one owner text and records why; summary, hash and class stay. */
  redactOwnerText(seq: number, by: { actor: string; reason: string }): Appended {
    return this.#tx(() => {
      const cur = this.#db.prepare("SELECT text FROM owner_text WHERE seq = ?").get(seq) as Row | undefined;
      if (!cur) throw new ContractError(`no owner text at seq ${seq}`);
      const out = this.#insert(
        {
          type: "owner_text_redacted",
          source: "owner-text redact",
          actor: by.actor,
          subject: `owner_action:${seq}`,
          dedupe_key: `owner_text_redacted:${seq}`,
          payload: { seq, reason: by.reason },
        },
        true,
      );
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
      if (this.#backup) appendLines(this.#backup, [{ counter: kind, last: Number(row.last) }]);
      return `${kind}${String(row.last).padStart(3, "0")}`;
    });
  }

  /** The resource round's load sample at the store clock, older ones pruned in the same transaction (decision 241). */
  recordLoadSample(s: SampleReads): void {
    this.#tx(() => writeSample(this.#db, Date.parse(this.#now()), s));
  }

  /** Decision 250: the load samples after `since` (epoch ms) for the panel's card; writes nothing. */
  loadSamples(since: number): StoredSample[] {
    return readSamples(this.#db, since);
  }

  close(): void {
    this.#db.close();
  }
}
