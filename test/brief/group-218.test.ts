import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGroup, itemFacts } from "../../core/index.ts";
import { groupWorld } from "./group-world.ts";

// Decision 218: the 묶음 상세 counts and the why table come from one reading.

test("every item the group counts 🚧 has a why row, with the lead's reason for an Orca-blocked one", async () => {
  const input = await (await groupWorld()).input();
  const m = buildGroup(input, "api-migration");
  assert.ok(m);
  const blocked = itemFacts(input)
    .filter((f) => f.lead === "api-migration" && (f.state === "blocked" || f.state === "pr_closed"))
    .map((f) => f.alias);
  assert.equal(blocked.length, m.figures.blocked);
  const rows = new Set(m.why.rows.map((r) => r.id));
  for (const a of blocked) assert.ok(rows.has(a), `${a} is 🚧 with no why row`);
  const i033 = m.why.rows.find((r) => r.id === "i033");
  assert.deepEqual(
    i033?.cells.map((c) => c.text).slice(2),
    ["orca", "🚧 막힘", "키 도착 확인"],
  );
});

test("the header's 건 is the open items the figure cells add up to, and 막힘 is the 🚧 cell", async () => {
  const m = buildGroup(await (await groupWorld()).input(), "api-migration");
  assert.ok(m);
  const f = m.figures;
  assert.equal(m.items, f.doing + f.blocked + f.left);
  assert.equal(m.blockedCount, f.blocked);
});
