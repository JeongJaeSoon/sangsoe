// Decision 205: the panel learns of a store write from the store itself. A watch on the store folder
// tells only when the newest seq moves, so reads, open/close checkpoints and -shm churn tell nothing.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store, storeSeq, watchStore } from "../../core/index.ts";

const until = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

const released = (ref: string) => ({
  type: "waiting_released" as const,
  source: "test",
  dedupe_key: `waiting_released:${ref}`,
  payload: { ref, outcome: "answered" as const, by: "owner" as const, evidence: "test" },
});

test("a write by another handle that then closes is told within the bound, with its seq; a read alone is not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-watch-"));
  const path = join(dir, "sangsoe.db");
  try {
    const first = Store.open({ path });
    const start = first.append(released("101")).seq;
    first.close();
    assert.equal(storeSeq(path), start);

    const told: number[] = [];
    const w = watchStore((seq) => void told.push(seq), { path });
    assert.ok(w.ok, JSON.stringify(w));
    try {
      // A reader opens, reads and closes (a checkpoint may rewrite the files): no new seq, nothing told.
      const reader = Store.open({ path });
      reader.events();
      reader.close();
      assert.equal(storeSeq(path), start);
      await new Promise((r) => setTimeout(r, 600));
      assert.equal(told.length, 0, "a read is not a change");

      const writer = Store.open({ path });
      const next = writer.append(released("102")).seq;
      writer.close();
      assert.ok(await until(() => told.includes(next), 3000), `told ${JSON.stringify(told)}, wanted ${next}`);
      assert.equal(new Set(told).size, told.length, "one seq is told once");
    } finally {
      w.ok && w.value.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a store that does not exist yet reads as no seq, and its watch is refused in words, not thrown", () => {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-watch-none-"));
  try {
    assert.equal(storeSeq(join(dir, "sangsoe.db")), null);
    const w = watchStore(() => {}, { path: join(dir, "missing", "sangsoe.db") });
    assert.equal(w.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
