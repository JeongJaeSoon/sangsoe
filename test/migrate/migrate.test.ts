import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { migrate } from "../../cli/commands/migrate.ts";
import { run } from "../../cli/main.ts";
import { applyImport, decisionKey, importedFrom, type OrcaAdapter, planImport, readOldState, Store } from "../../core/index.ts";
import { createWorld } from "../decision/world.ts";
import { createGraphWorld } from "../graph/world.ts";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Row = Record<string, string | number | null>;

// The tables agent-skills' store.py creates, cut to the columns the import reads.
const DDL = `
CREATE TABLE migration (step TEXT PRIMARY KEY, ts TEXT NOT NULL, backup TEXT NOT NULL, sources TEXT NOT NULL, stage TEXT NOT NULL);
CREATE TABLE decision (id TEXT PRIMARY KEY, status TEXT NOT NULL, title TEXT NOT NULL, body TEXT, options TEXT NOT NULL DEFAULT '[]',
  recommend INTEGER, link TEXT, handle TEXT, created_at TEXT NOT NULL, closed_at TEXT);
CREATE TABLE item (id TEXT PRIMARY KEY, status TEXT NOT NULL, lane TEXT NOT NULL, pos INTEGER NOT NULL, who TEXT, title TEXT NOT NULL,
  next TEXT, waiting INTEGER NOT NULL DEFAULT 0, waiting_since TEXT, trig TEXT, due TEXT, after_ref TEXT, program TEXT, note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);
CREATE TABLE board_row (id TEXT PRIMARY KEY, parent TEXT, pos INTEGER NOT NULL, data TEXT NOT NULL, done_at TEXT);
CREATE TABLE lead (name TEXT PRIMARY KEY, data TEXT NOT NULL, closed_at TEXT);
`;

const T = "2026-11-01T00:00:00Z";
const item = (id: string, o: Row = {}): Row => ({ id, status: "todo", lane: "todo", pos: 1, who: "lead:api", title: `title ${id}`, next: null, trig: null, due: null, after_ref: null, program: null, note: null, created_at: T, updated_at: T, closed_at: null, ...o });

function oldDb(o: { items?: Row[]; decisions?: Row[]; steps?: string[] } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-migrate-"));
  dirs.push(dir);
  const path = join(dir, "agent-skills.db");
  const db = new DatabaseSync(path);
  db.exec(DDL);
  for (const step of o.steps ?? ["4a-decisions", "4b-board"]) db.prepare("INSERT INTO migration VALUES (?, ?, 'b', '[]', 'tombstoned')").run(step, T);
  const insert = (table: string, r: Row) => {
    const cols = Object.keys(r);
    db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...Object.values(r));
  };
  for (const r of o.items ?? []) insert("item", r);
  for (const r of o.decisions ?? []) insert("decision", { status: "open", body: null, recommend: null, link: null, created_at: T, closed_at: null, ...r });
  insert("board_row", { id: "lead:api", parent: null, pos: 1, data: "{}", done_at: null });
  insert("board_row", { id: "lead:old", parent: null, pos: 2, data: "{}", done_at: T });
  insert("lead", { name: "api", data: "{}", closed_at: null });
  db.close();
  return path;
}

const options = (...labels: string[]) => JSON.stringify(labels.map((label) => ({ label, description: `why ${label}` })));

const SAMPLE = {
  items: [
    item("b1", { next: "next b1", note: "note b1", program: "acme" }),
    item("b2", { status: "doing", lane: "doing" }),
    item("b3", { status: "held", lane: "later", trig: "when acme ships" }),
    item("b4", { lane: "owner_todo", who: null, due: "2026-11-20T00:00:00+09:00", after_ref: "b1" }),
    item("b5", { after_ref: "first report arrives" }),
    item("b6", { status: "done", closed_at: T }),
    item("b7", { status: "dropped", lane: "later", closed_at: T }),
  ],
  decisions: [
    { id: "d1", title: "pick a store", body: "two ways", options: options("files", "sqlite"), recommend: 2, link: "https://example.com/d1" },
    { id: "d2", status: "done", title: "closed one", options: options("a", "b"), closed_at: T },
  ],
};

test("readOldState: only open items and open decisions, closed and Orca-owned rows only counted", () => {
  const r = readOldState(oldDb(SAMPLE));
  assert.ok(r.ok);
  const s = r.value;
  assert.deepEqual(s.items.map((i) => [i.id, i.status]), [["b1", "todo"], ["b2", "doing"], ["b3", "held"], ["b4", "todo"], ["b5", "todo"]]);
  assert.deepEqual(s.decisions.map((d) => d.id), ["d1"]);
  // The recommended option (1-based) goes first: the brief reads the gate's first option as 추천.
  assert.deepEqual(s.decisions[0]?.options, ["sqlite", "files"]);
  assert.deepEqual(s.skipped, { closedItems: 2, closedDecisions: 1, boardRows: 1, leads: 1 });
});

test("readOldState: the old store is only read, and an unfinished old cutover or a missing file is refused", () => {
  const path = oldDb(SAMPLE);
  const before = createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.ok(readOldState(path).ok);
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), before);
  assert.equal(existsSync(`${path}-wal`), false);

  const half = readOldState(oldDb({ steps: ["4a-decisions"] }));
  assert.equal(half.ok ? "" : half.refusal.code, "old_store_not_migrated");
  const none = readOldState(join(tmpdir(), "sangsoe-migrate-none", "agent-skills.db"));
  assert.equal(none.ok ? "" : none.refusal.code, "old_store_missing");
});

test("planImport: each open item becomes one Task with extras; text stays out of the extras", () => {
  const r = readOldState(oldDb(SAMPLE));
  assert.ok(r.ok);
  const plan = planImport(r.value, importedFrom(Store.open({ path: ":memory:" })));
  assert.deepEqual(plan.counts, {
    items: { open: 5, create: 5, already: 0, todo: 3, doing: 1, held: 1 },
    decisions: { open: 1, create: 1, already: 0 },
    edges: { create: 1, already: 0 },
    skipped: { closedItems: 2, closedDecisions: 1, boardRows: 1, leads: 1 },
  });
  const by = new Map(plan.items.map((p) => [p.id, p]));
  assert.deepEqual(by.get("b1")?.extra, { links: ["request:agent-skills/item/b1", "agent-skills-program:acme"] });
  assert.match(by.get("b1")?.create.spec ?? "", /^title b1\nnext b1\nnote b1\n/);
  assert.deepEqual(by.get("b3")?.extra, { hold: true, trigger: "when acme ships", links: ["request:agent-skills/item/b3"] });
  assert.deepEqual(by.get("b4")?.extra, { exec_by: "owner", trigger: "due 2026-11-20T00:00:00+09:00", links: ["request:agent-skills/item/b4"] });
  assert.equal(by.get("b4")?.create.who, "owner");
  assert.deepEqual(by.get("b5")?.extra, { trigger: "after first report arrives", links: ["request:agent-skills/item/b5"] });
  assert.deepEqual(plan.edges, [{ pred: "b1", succ: "b4", kind: "after", action: "create" }]);
  assert.equal(plan.decisions[0]?.subject, "scope:agent-skills-d1");
  assert.match(plan.decisions[0]?.question ?? "", /pick a store/);
});

test("applyImport: Tasks, extras, the edge through GRAPH; a second run creates nothing", async () => {
  const w = createGraphWorld();
  const r = readOldState(oldDb({ items: SAMPLE.items }));
  assert.ok(r.ok);
  const first = await applyImport(w, r.value, { run: "run_a" });
  assert.ok(first.ok, JSON.stringify(first));
  assert.deepEqual(first.value.created, { items: 5, decisions: 0, edges: 1 });
  assert.equal(w.tasks.size, 5);
  assert.equal(w.store.events({ type: "item_created" }).length, 5);
  assert.equal(w.store.events({ type: "edge_added" }).length, 1);
  // Imported text lives in the Orca Task only, never in an event.
  const rows = JSON.stringify(w.store.events());
  for (const text of ["title b1", "next b1", "note b1"]) assert.equal(rows.includes(text), false, text);
  assert.ok([...w.tasks.values()].some((t) => t.title === "title b1"));

  const again = await applyImport(w, r.value, { run: "run_a" });
  assert.ok(again.ok);
  assert.deepEqual(again.value.created, { items: 0, decisions: 0, edges: 0 });
  assert.deepEqual(again.value.already, { items: 5, decisions: 0, edges: 1 });
  assert.equal(w.tasks.size, 5);
  const plan = planImport(r.value, importedFrom(w.store));
  assert.deepEqual([plan.counts.items.create, plan.counts.items.already], [0, 5]);
});

test("applyImport: an open decision through decisionOpen, once", async () => {
  const w = createWorld([], { currentRun: "run_o" });
  const r = readOldState(oldDb({ decisions: SAMPLE.decisions }));
  assert.ok(r.ok);
  const first = await applyImport(w, r.value, { run: "run_o" });
  assert.ok(first.ok, JSON.stringify(first));
  assert.deepEqual(first.value.created, { items: 0, decisions: 1, edges: 0 });
  const opened = w.store.events({ type: "decision_opened" });
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.payload.decision_key, decisionKey("scope:agent-skills-d1", ["files", "sqlite"]));
  assert.equal(w.gates.size, 1);
  assert.match([...w.gates.values()][0]?.question ?? "", /pick a store/);

  const again = await applyImport(w, r.value, { run: "run_o" });
  assert.ok(again.ok);
  assert.deepEqual(again.value.already, { items: 0, decisions: 1, edges: 0 });
  assert.equal(w.gates.size, 1);
});

test("sangsoe migrate: dry run by default, no Orca call, no store created, no titles; --apply needs --run", async () => {
  const from = oldDb(SAMPLE);
  const storePath = join(dirs.at(-1) as string, "sangsoe.db");
  let orcaCalls = 0;
  const orca = new Proxy({} as OrcaAdapter, {
    get: () => () => {
      orcaCalls++;
      throw new Error("a dry run calls Orca");
    },
  });
  const dry = await migrate({ from }, { orca, storePath });
  assert.ok(dry.ok);
  const value = dry.value as { mode: string; counts: { items: { create: number } }; plan: string[] };
  assert.equal(value.mode, "dry-run");
  assert.equal(value.counts.items.create, 5);
  assert.ok(value.plan.includes("b4 item todo create"));
  assert.ok(value.plan.includes("b1>b4 edge after create"));
  assert.equal(JSON.stringify(dry).includes("title b"), false);
  assert.equal(orcaCalls, 0);
  assert.equal(existsSync(storePath), false);

  const noRun = await migrate({ from, apply: true }, { orca, storePath });
  assert.equal(noRun.ok ? "" : noRun.refusal.code, "invalid_input");
  const both = await migrate({ from, apply: true, "dry-run": true, run: "run_a" }, { orca, storePath });
  assert.equal(both.ok ? "" : both.refusal.code, "invalid_input");
  assert.equal(orcaCalls, 0);

  const w = createGraphWorld();
  const applied = await migrate({ from: oldDb({ items: SAMPLE.items }), apply: true, run: "run_a" }, { orca: w.orca, store: w.store });
  assert.ok(applied.ok);
  assert.deepEqual((applied.value as { created: unknown }).created, { items: 5, decisions: 0, edges: 1 });
});

test("sangsoe migrate --help and an unknown argument touch nothing (R-16)", async () => {
  const help = await run(["migrate", "--help"]);
  assert.equal(help.code, 0);
  assert.match(help.out, /^usage:/);
  assert.equal((await run(["migrate", "--bogus"])).code, 2);
});

test("applyImport: a refused task-create stops the run and writes nothing for that item", async () => {
  const w = createGraphWorld();
  w.failCreateAfter(1);
  const r = readOldState(oldDb({ items: [item("b1"), item("b2")] }));
  assert.ok(r.ok);
  const res = await applyImport(w, r.value, { run: "run_a" });
  assert.equal(res.ok ? "" : res.refusal.code, "task_create_failed");
  assert.equal(w.store.events({ type: "item_created" }).length, 1);
  w.failCreateAfter(null);
  const resumed = await applyImport(w, r.value, { run: "run_a" });
  assert.ok(resumed.ok);
  assert.deepEqual([resumed.value.created.items, resumed.value.already.items], [1, 1]);
});
