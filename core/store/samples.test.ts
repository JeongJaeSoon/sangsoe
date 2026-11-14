import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { scratchDir } from "../../test/scratch.ts";
import { backupPath } from "./backup.ts";
import { SAMPLE_RETENTION_MS } from "./samples.ts";
import { Store } from "./store.ts";

const tmp = scratchDir("sangsoe-samples-");
const local = () => "apfs";
const T0 = Date.parse("2026-11-14T00:00:00.000Z");
let n = 0;

function open() {
  let now = T0;
  const path = join(tmp, `s${n++}.db`);
  const store = Store.open({ path, clock: () => new Date(now).toISOString(), fsProbe: local });
  return { path, store, set: (ms: number) => (now = ms) };
}

const rows = (path: string) => {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return raw.prepare("SELECT at, load5, cpus, mem_free_pct, disk_free_gb FROM load_sample ORDER BY at").all().map((r) => ({ ...r }));
  } finally {
    raw.close();
  }
};

test("a sample is one row at the store clock's time; a field the OS did not give is null", () => {
  const { path, store } = open();
  store.recordLoadSample({ load5: 2.5, cpus: 8, memFreePct: 41.5, diskFreeGb: 120 });
  store.recordLoadSample({ cpus: 8 });
  store.close();
  assert.deepEqual(rows(path), [
    { at: T0, load5: null, cpus: 8, mem_free_pct: null, disk_free_gb: null },
  ], "a second write at the same instant replaces the first");
});

test("each write drops the samples 24h old or older, and only those", () => {
  const { path, store, set } = open();
  store.recordLoadSample({ load5: 1 });
  set(T0 + 1);
  store.recordLoadSample({ load5: 2 });
  set(T0 + SAMPLE_RETENTION_MS);
  store.recordLoadSample({ load5: 3 });
  store.close();
  assert.deepEqual(rows(path).map((r) => r.load5), [2, 3]);
});

test("a schema-2 database gains load_sample on open (schema 3) and keeps its events", () => {
  const { path, store } = open();
  store.append({ type: "signal", source: "t", payload: { kind: "wait", reason: "r" } });
  store.close();
  const raw = new DatabaseSync(path);
  raw.exec("DROP TABLE load_sample; DELETE FROM migration WHERE version = 3;");
  raw.close();
  const again = Store.open({ path, clock: () => new Date(T0).toISOString(), fsProbe: local });
  assert.equal(again.schemaVersion(), 3);
  assert.equal(again.events({ type: "signal" }).length, 1);
  again.recordLoadSample({ load5: 1 });
  again.close();
  assert.equal(rows(path).length, 1);
});

test("samples never reach the facts file, and a rebuilt store starts with none", () => {
  const { path, store } = open();
  const before = readFileSync(backupPath(path), "utf8");
  store.recordLoadSample({ load5: 1, cpus: 8 });
  assert.equal(readFileSync(backupPath(path), "utf8"), before, "no line for a sample");
  store.append({ type: "signal", source: "t", payload: { kind: "wait", reason: "r" } });
  store.close();
  for (const s of ["", "-wal", "-shm"]) rmSync(path + s, { force: true });
  const rebuilt = Store.open({ path, clock: () => new Date(T0).toISOString(), fsProbe: local });
  assert.ok(rebuilt.rebuilt, "the lost file was rebuilt from the facts file");
  rebuilt.close();
  assert.deepEqual(rows(path), []);
});
