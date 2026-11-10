import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dedupeKey, EVENTS } from "../contract/index.ts";
import { defaultDbPath, HOST_WINDOW_LOST, Store } from "../store/store.ts";
import type { CheckContext } from "./check.ts";
import { DOCTOR_CHECKS, START_CHECKS } from "./index.ts";
import { storeRestore } from "./store-restore.ts";

const run = (home: string) => storeRestore.run({ home } as CheckContext);
const home = () => mkdtempSync(join(tmpdir(), "sangsoe-restore-home-"));

test("doctor rebuilds a lost database and names, one by one, what could not be restored", async () => {
  const h = home();
  try {
    const s = Store.open({ home: h });
    const a = s.appendOwnerAction({ type: "owner_action", source: "hook", payload: { origin: "chat", summary: "s", hash: "h" } }, "text");
    s.append({ type: "decision_opened", source: "t", dedupe_key: dedupeKey(EVENTS.decision_opened, "k"), payload: { decision: "d001", decision_key: "k" } });
    s.append({ type: "decision_answered", source: "hook", payload: { decision: "d001", owner_action: a.seq, answer: "yes", linked_by: "hook" } });
    s.close();
    assert.equal((await run(h)).status, "ok", "an intact database has nothing to report");
    rmSync(defaultDbPath(h));

    const r = await run(h);
    assert.equal(r.status, "notice");
    assert.match(r.summary, /되살리지 못한 것/);
    assert.match(r.summary, /- owner_text: the masked text of 1 owner_action row/);
    assert.ok(r.summary.includes(`- ${HOST_WINDOW_LOST}`));
    assert.match(r.fix ?? "", /Orca 를 열면/, "host rows wait for the monitors");
    const back = Store.open({ home: h });
    assert.deepEqual(
      back.events().map((e) => e.type),
      ["owner_action", "decision_opened", "decision_answered", "signal"],
      "doctor's open restored the own facts",
    );
    back.close();
  } finally {
    rmSync(h, { recursive: true });
  }
});

test("a machine with no database is not given one by doctor", async () => {
  const h = home();
  try {
    assert.equal((await run(h)).status, "ok");
    assert.equal(existsSync(defaultDbPath(h)), false);
  } finally {
    rmSync(h, { recursive: true });
  }
});

test("the row is doctor-only, so a session start stays quiet", () => {
  assert.ok(DOCTOR_CHECKS.includes(storeRestore));
  assert.ok(!START_CHECKS.includes(storeRestore));
});
