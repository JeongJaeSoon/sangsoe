import { existsSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { done, type Result, refuse } from "../notify/result.ts";
import { defaultDbPath } from "../store/store.ts";

// What tells the panel the store moved (decision 205). The panel's own reads must not count, so the
// signal is the newest event seq, not a file's time: a reader's close can checkpoint the WAL into the
// database file, and every reader touches -shm.

/** The newest event seq, read with SELECT only (no migration, no checkpoint); null when there is none to read. */
export function storeSeq(path: string = defaultDbPath()): number | null {
  if (!existsSync(path)) return null;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
  try {
    const v = (db.prepare("SELECT max(seq) AS n FROM event").get() as { n?: unknown } | undefined)?.n;
    return typeof v === "number" || typeof v === "bigint" ? Number(v) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Coalesces a burst of file events into one seq read. */
const SETTLE_MS = 150;

/** Calls `onChange` once per new newest seq while open. The store's folder must exist. */
export function watchStore(onChange: (seq: number) => void, o: { path?: string } = {}): Result<{ close(): void }> {
  const path = o.path ?? defaultDbPath();
  const name = basename(path);
  let last = storeSeq(path);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    timer = null;
    const seq = storeSeq(path);
    if (seq === null || seq === last) return;
    last = seq;
    onChange(seq);
  };
  let w: ReturnType<typeof watch>;
  try {
    w = watch(dirname(path), (_kind, file) => {
      const f = String(file ?? "");
      if (file && (!f.startsWith(name) || f.endsWith("-shm"))) return;
      timer ??= setTimeout(check, SETTLE_MS);
    });
  } catch (e) {
    return refuse("watch_failed", `${dirname(path)}: ${e instanceof Error ? e.message : String(e)}`, "the panel re-reads on its interval");
  }
  w.on("error", () => w.close());
  return done({
    close() {
      if (timer) clearTimeout(timer);
      timer = null;
      w.close();
    },
  });
}
