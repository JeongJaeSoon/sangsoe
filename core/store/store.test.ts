import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { defineEvent, fixedClock, int, str } from "../contract/index.ts";
import { TABLES } from "./schema.ts";
import { decodeRow, defaultDbPath, REDACTED_MARK, StartRefused, Store } from "./store.ts";

const T0 = "2026-11-10T00:00:00.000Z";
const tmp = mkdtempSync(join(tmpdir(), "sangsoe-store-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const local = () => "apfs";
const mem = () => Store.open({ path: ":memory:", clock: fixedClock(T0, 1000) });
let n = 0;
const fileStore = () => {
  const path = join(tmp, `s${n++}.db`);
  return { path, store: Store.open({ path, clock: fixedClock(T0, 1000), fsProbe: local }) };
};

test("opens ~/.local/share/sangsoe/sangsoe.db under the given home and records schema_v (1)", () => {
  const home = join(tmp, "home");
  const store = Store.open({ home, clock: fixedClock(T0), fsProbe: local });
  const path = defaultDbPath(home);
  assert.equal(path, join(home, ".local/share/sangsoe/sangsoe.db"));
  assert.ok(existsSync(path));
  assert.equal(store.schemaVersion(), 1);
  store.close();
  const again = Store.open({ home, clock: fixedClock(T0), fsProbe: local });
  assert.equal(again.schemaVersion(), 1, "reopening does not migrate twice");
  again.close();
  const raw = new DatabaseSync(path);
  assert.equal((raw.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
  raw.close();
});

test("a database from a newer schema is refused", () => {
  const { path, store } = fileStore();
  store.close();
  const raw = new DatabaseSync(path);
  raw.prepare("INSERT INTO migration (version, applied_at, note) VALUES (99, ?, 'future')").run(T0);
  raw.close();
  assert.throws(() => Store.open({ path, fsProbe: local }), /newer than this build/);
});

test("the store refuses a database on a network filesystem before opening it (3)", () => {
  const path = join(tmp, "nfs", "sangsoe.db");
  assert.throws(
    () => Store.open({ path, fsProbe: () => "nfs" }),
    (e: unknown) => e instanceof StartRefused && e.checks.some((c) => c.name === "db_filesystem" && !c.ok),
  );
  assert.ok(!existsSync(path), "nothing is created on a refused path");
});

test("event rows can be neither updated nor deleted (2, C2)", () => {
  const { path, store } = fileStore();
  store.append({ type: "turn_ended", source: "Stop", payload: { session: "s" } });
  store.close();
  const raw = new DatabaseSync(path);
  assert.throws(() => raw.exec("UPDATE event SET source = 'x'"), /event is append-only/);
  assert.throws(() => raw.exec("DELETE FROM event"), /event is append-only/);
  raw.close();
});

test("UNIQUE(dedupe_key): a second writer of the same key gets the first row back (2, C2)", () => {
  const store = mem();
  const key = "notify:lead:api:item_ready:task_b2";
  const payload = { msg_id: "m1", to: "run:r1", msg_type: "status" };
  const a = store.append({ type: "notified", source: "notify", dedupe_key: key, payload });
  const b = store.append({ type: "notified", source: "queue-monitor", dedupe_key: key, payload });
  assert.deepEqual(a, { seq: 1, inserted: true });
  assert.deepEqual(b, { seq: 1, inserted: false }, "ON CONFLICT DO NOTHING RETURNING yields no row; the existing seq is read");
  assert.equal(store.events().length, 1);
});

test("append validates type, payload, dedupe prefix and the transition table", () => {
  const store = mem();
  assert.throws(() => store.append({ type: "nope", source: "x", payload: {} } as never), /unknown event type/);
  assert.throws(
    () => store.append({ type: "pr_merged", source: "x", payload: { pr: "Acme/API#1", merge_sha: "abc1234" } }),
    /lowercase/,
  );
  assert.throws(
    () => store.append({ type: "item_ready", source: "x", dedupe_key: "item_ready:t", payload: { task: "t" } }),
    /start with "ready:"/,
  );
  const transition = (from: "planned" | "done", to: "in_progress" | "ready") =>
    store.append({ type: "item_transition", source: "lead:a", payload: { task: "t", from, to, reason: "r" } });
  assert.throws(() => transition("planned", "in_progress"), /not in the transition table/);
  assert.throws(() => transition("done", "ready"), /not in the transition table/);
  assert.equal(store.events().length, 0, "a refused append writes nothing");
});

test("timestamps come from the injected clock (6)", () => {
  const store = mem();
  store.append({ type: "turn_ended", source: "Stop", payload: { session: "s" } });
  store.append({ type: "turn_ended", source: "Stop", payload: { session: "s" } });
  assert.deepEqual(
    store.events().map((e) => e.ts),
    ["2026-11-10T00:00:01.000Z", "2026-11-10T00:00:02.000Z"],
    "the first tick went to the migration row",
  );
  assert.throws(() => Store.open({ path: ":memory:", clock: () => "yesterday" }), /ISO UTC/);
});

test("owner text lives apart from the event and may only be emptied, after owner_text_redacted (2)", () => {
  const { path, store } = fileStore();
  const action = store.appendOwnerAction(
    { type: "owner_action", source: "UserPromptSubmit", payload: { origin: "chat", summary: "s", hash: "h" } },
    "deploy with token ****",
  );
  const [row] = store.events({ type: "owner_action" });
  assert.ok(row);
  assert.ok(!JSON.stringify(row).includes("deploy with token"), "the event row holds no original text");
  assert.equal(store.ownerText(action.seq), "deploy with token ****");
  store.close();

  const raw = new DatabaseSync(path);
  assert.throws(() => raw.exec(`UPDATE owner_text SET text = NULL WHERE seq = ${action.seq}`), /only be emptied/);
  assert.throws(() => raw.exec(`UPDATE owner_text SET text = 'other' WHERE seq = ${action.seq}`), /only be emptied/);
  assert.throws(() => raw.exec("DELETE FROM owner_text"), /never deleted/);
  assert.throws(() => raw.exec("INSERT INTO owner_text (seq, text) VALUES (999, 'x')"), /belongs to an owner_action/);
  raw.close();

  const again = Store.open({ path, clock: fixedClock(T0), fsProbe: local });
  const red = again.redactOwnerText(action.seq, { actor: "owner", reason: "secret leaked" });
  assert.ok(red.inserted);
  assert.equal(again.ownerText(action.seq), REDACTED_MARK);
  const redacted = again.events({ type: "owner_text_redacted" });
  assert.deepEqual(redacted[0]?.payload, { seq: action.seq, reason: "secret leaked" });
  assert.equal(again.events({ type: "owner_action" })[0]?.payload.summary, "s", "summary and hash stay");
  assert.equal(again.redactOwnerText(action.seq, { actor: "owner", reason: "again" }).inserted, false);
  again.close();
});

test("old rows are read: upcast from their schema_v, unknown fields ignored, unknown types passed through (1)", () => {
  const v2 = defineEvent(
    "sample",
    { count: int, label: str },
    { version: 2, upcast: { 1: (old) => ({ ...old, label: String(old.name ?? "none") }) } },
  );
  const row = {
    seq: 5,
    ts: T0,
    type: "sample",
    source: "test",
    target: null,
    subject: null,
    entity: null,
    entity_id: null,
    actor: null,
    needs: "none",
    severity: null,
    dedupe_key: null,
    schema_v: 1,
    before: null,
    after: JSON.stringify({ count: 3, name: "old", extra: true }),
  };
  const read = decodeRow(row, (t) => (t === "sample" ? v2 : undefined));
  assert.equal(read.schema_v, 1);
  assert.deepEqual(read.payload, { count: 3, name: "old", extra: true, label: "old" });
  assert.deepEqual(decodeRow({ ...row, type: "from_the_future" }, () => undefined).payload.name, "old");
  assert.throws(() => decodeRow(row, () => ({ ...v2, version: 3 })), /no upcast from schema_v 2/);
});

test("iNNN and dNNN are issued from counter and never reused", () => {
  const store = mem();
  assert.deepEqual([store.allocate("i"), store.allocate("i"), store.allocate("d")], ["i001", "i002", "d001"]);
});

test("the schema holds no view cache and no copy of an Orca table", () => {
  const { path, store } = fileStore();
  store.close();
  const raw = new DatabaseSync(path);
  const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    .map((r) => r.name)
    .filter((n) => n !== "sqlite_sequence");
  const views = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all();
  raw.close();
  assert.deepEqual(tables.sort(), [...TABLES].sort());
  assert.deepEqual(views, []);
  for (const t of tables) assert.doesNotMatch(t, /cache|task|dispatch|run|gate|message|worktree/);
});
