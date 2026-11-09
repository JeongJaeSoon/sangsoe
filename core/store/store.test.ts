import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { dedupeKey, defineEvent, EVENTS, eventDef, fixedClock, int, str } from "../contract/index.ts";
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
  assert.equal(store.schemaVersion(), 2);
  store.close();
  const again = Store.open({ home, clock: fixedClock(T0), fsProbe: local });
  assert.equal(again.schemaVersion(), 2, "reopening does not migrate twice");
  again.close();
  const raw = new DatabaseSync(path);
  assert.equal((raw.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
  assert.equal((raw.prepare("SELECT count(*) AS n FROM migration").get() as { n: number }).n, 2);
  raw.close();
});

test("a schema-1 database gains the edge triggers on open (schema 2)", () => {
  const { path, store } = fileStore();
  store.close();
  const raw = new DatabaseSync(path);
  raw.exec("DROP TRIGGER edge_no_cycle; DROP TRIGGER edge_source_graph; DELETE FROM migration WHERE version = 2;");
  raw.close();
  const again = Store.open({ path, clock: fixedClock(T0), fsProbe: local });
  assert.equal(again.schemaVersion(), 2);
  const add = (pred: string, succ: string) =>
    again.append({ type: "edge_added", source: "GRAPH", dedupe_key: dedupeKey(EVENTS.edge_added, pred, succ, "blocks"), payload: { pred, succ, kind: "blocks" } });
  add("a", "b");
  assert.throws(() => add("b", "a"), /edge would create a cycle/);
  again.close();
});

test("edge triggers: a cycle and a non-GRAPH writer are refused below the contract", () => {
  const { path, store } = fileStore();
  const edge = (pred: string, succ: string, kind: "blocks" | "after" = "blocks") => ({ pred, succ, kind }) as const;
  const key = (p: string, s: string, k = "blocks", ...c: string[]) => dedupeKey(EVENTS.edge_added, p, s, k, ...c);
  store.append({ type: "edge_added", source: "GRAPH", dedupe_key: key("a", "b"), payload: edge("a", "b") });
  store.append({ type: "edge_added", source: "GRAPH", dedupe_key: key("b", "c", "after"), payload: edge("b", "c", "after") });
  assert.throws(
    () => store.append({ type: "edge_added", source: "GRAPH", dedupe_key: key("c", "a"), payload: edge("c", "a") }),
    /edge would create a cycle/,
  );
  assert.throws(
    () => store.append({ type: "edge_added", source: "GRAPH", dedupe_key: key("a", "a"), payload: edge("a", "a") }),
    /edge would create a cycle/,
  );
  store.append({ type: "edge_removed", source: "GRAPH", payload: { ...edge("b", "c", "after"), reason: "order dropped" } });
  store.append({ type: "edge_added", source: "GRAPH", dedupe_key: key("c", "a"), payload: edge("c", "a") });
  store.close();
  const raw = new DatabaseSync(path);
  const insert = raw.prepare("INSERT INTO event (ts, type, source, after) VALUES ('t', 'edge_added', ?, ?)");
  assert.throws(() => insert.run("lead:x", JSON.stringify(edge("x", "y"))), /only by GRAPH/);
  assert.throws(() => insert.run("GRAPH", JSON.stringify(edge("b", "c"))), /edge would create a cycle/);
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
  const notified = eventDef("notified");
  assert.ok(notified);
  const key = dedupeKey(notified, "lead:api", "item_ready", "task_b2");
  assert.equal(key, "notify:lead%3Aapi:item_ready:task_b2");
  const payload = { msg_id: "m1", to: "run:r1", msg_type: "status" };
  const a = store.append({ type: "notified", source: "notify", target: "lead:api", dedupe_key: key, payload });
  const b = store.append({ type: "notified", source: "queue-monitor", target: "lead:api", dedupe_key: key, payload });
  assert.deepEqual(a, { seq: 1, inserted: true });
  assert.deepEqual(b, { seq: 1, inserted: false }, "ON CONFLICT DO NOTHING RETURNING yields no row; the existing seq is read");
  const raw = "notify:lead:api:item_ready:task_b2";
  assert.throws(
    () => store.append({ type: "notified", source: "notify", target: "lead:api", dedupe_key: raw, payload }),
    /keys are "notify:lead%3Aapi\[/,
    "the unencoded spelling of the same condition is refused, so it cannot become a second row",
  );
  assert.throws(() => store.append({ type: "notified", source: "notify", dedupe_key: key, payload }), /names who was told/);
  const edge = { pred: "task:a", succ: "task:b", kind: "blocks" } as const;
  const edgeKey = "edge:task%3Aa:task%3Ab:blocks";
  assert.equal(store.append({ type: "edge_added", source: "GRAPH", dedupe_key: edgeKey, payload: edge }).inserted, true);
  assert.throws(
    () => store.append({ type: "edge_added", source: "GRAPH", dedupe_key: "edge:task:a:task:b:blocks", payload: edge }),
    /keys are "edge:task%3Aa:task%3Ab:blocks\[:<condition>\]"/,
  );
  assert.equal(store.append({ type: "edge_added", source: "GRAPH", dedupe_key: edgeKey, payload: edge }).inserted, false);
  assert.equal(store.events().length, 2);
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

test("append guards: writer, unknown or nested Orca fields, required and payload-bound keys, store-only types", () => {
  const store = mem();
  const edge = { pred: "a", succ: "b", kind: "blocks" } as const;
  assert.throws(
    () => store.append({ type: "edge_added", source: "lead:x", dedupe_key: "edge:a:b:blocks", payload: edge }),
    /only by GRAPH/,
  );
  assert.throws(() => store.append({ type: "edge_added", source: "GRAPH", payload: edge }), /needs a dedupe_key/);
  assert.throws(
    () => store.append({ type: "turn_ended", source: "Stop", payload: { session: "s", extra: 1 } as never }),
    /unknown payload field/,
  );
  assert.throws(
    () =>
      store.append({
        type: "evidence",
        source: "w",
        payload: { kind: "unit", not_verified: [{ task: { title: "copied" } }] } as never,
      }),
    /Orca owns this fact/,
  );
  assert.throws(
    () => store.append({ type: "item_ready", source: "queue-monitor", dedupe_key: "ready:t2:h", payload: { task: "t1" } }),
    /keys are "ready:t1\[/,
  );
  assert.throws(
    () => store.append({ type: "item_ready", source: "queue-monitor", dedupe_key: "ready:t1:x:h", payload: { task: "t1:x" } }),
    /keys are "ready:t1%3Ax\[/,
  );
  const ready = eventDef("item_ready");
  assert.ok(ready);
  const colon = store.append({
    type: "item_ready",
    source: "queue-monitor",
    dedupe_key: dedupeKey(ready, "t1:x", "h"),
    payload: { task: "t1:x" },
  });
  const plain = store.append({ type: "item_ready", source: "queue-monitor", dedupe_key: "ready:t1:x:h", payload: { task: "t1" } });
  assert.ok(colon.inserted && plain.inserted, "task t1:x and task t1 with condition x:h are two keys");
  assert.throws(
    () => store.append({ type: "resource", source: "w", payload: { action: "created", kind: "worktree", owner: "w", ref: "/Users/a/wt" } }),
    /Orca id, not a path/,
  );
  assert.throws(
    // @ts-expect-error VerifySpec is a union: orca_field needs field and value at compile time too
    () => store.append({ type: "item_extra_set", source: "lead:a", payload: { task: "t1", verify: { kind: "orca_field", target: "t1" } } }),
    /verify orca_field needs field/,
  );
  assert.throws(
    () => store.append({ type: "evidence", source: "w", payload: { kind: "probe:orca_field" } }),
    /a probe's evidence records what it observed/,
  );
  assert.throws(
    () => store.append({ type: "resource", source: "w", payload: { action: "created", kind: "worktree", owner: "w", ref: "not an id" } }),
    /Orca id, not a path/,
  );
  assert.throws(
    () => store.append({ type: "reap_blocked", source: "REAPER", payload: { ref: "/Users/a/wt", reason: "unpushed" } as never }),
    /kind: expected a value/,
  );
  store.append({
    type: "item_extra_set",
    source: "lead:a",
    payload: { task: "t1", verify: { kind: "pr_found", repo: "acme/api", search: "head:fix" } },
  });
  const owner = { origin: "chat", summary: "s", hash: "h" } as const;
  // @ts-expect-error store-only types are not in append's parameter type
  assert.throws(() => store.append({ type: "owner_action", source: "x", payload: owner }), /only by its Store method/);
  assert.throws(
    // @ts-expect-error store-only types are not in append's parameter type
    () => store.append({ type: "owner_text_redacted", source: "x", payload: { seq: 1, reason: "r" } }),
    /only by its Store method/,
  );
  assert.equal(store.events().length, 3);
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
  assert.throws(() => raw.exec("INSERT INTO owner_text (seq, text) VALUES (999, 'x')"), /text of an owner_action/);
  raw.exec(`INSERT INTO event (ts, type, source, after) VALUES ('${T0}', 'owner_action', 'raw', '{"origin":"chat","summary":"r","hash":"hr"}')`);
  assert.throws(
    () => raw.exec("INSERT INTO owner_text (seq, text) VALUES (last_insert_rowid(), NULL)"),
    /text of an owner_action/,
    "an owner_action row with no text is refused",
  );
  assert.throws(
    () => raw.exec("INSERT INTO owner_text (seq, text) VALUES (last_insert_rowid(), '')"),
    /text of an owner_action/,
    "nor with empty text: only a redaction empties it",
  );
  raw.close();

  const again = Store.open({ path, clock: fixedClock(T0), fsProbe: local });
  for (const bad of [null as never, ""]) {
    assert.throws(
      () =>
        again.appendOwnerAction(
          { type: "owner_action", source: "x", payload: { origin: "chat", summary: "s", hash: "h2" } },
          bad,
        ),
      /expected a non-empty string/,
    );
  }
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
