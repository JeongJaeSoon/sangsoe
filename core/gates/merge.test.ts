import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeVerdicts } from "./merge.ts";
import type { Decision, Verdict } from "./types.ts";

const v = (decision: Decision, reason: string): Verdict => ({ decision, gate: "start", reason });

// R-09 / #413: deny > ask > allow, every reason at the winning level kept.
const TABLE: [string, Verdict[], Decision | "none", string[]][] = [
  ["nothing", [], "none", []],
  ["allow only", [v("allow", "a")], "allow", ["a"]],
  ["ask beats allow", [v("allow", "a"), v("ask", "b")], "ask", ["b"]],
  ["deny beats ask", [v("ask", "b"), v("deny", "c")], "deny", ["c"]],
  ["deny beats allow", [v("deny", "c"), v("allow", "a")], "deny", ["c"]],
  ["two denies keep both reasons", [v("deny", "c"), v("ask", "b"), v("deny", "d")], "deny", ["c", "d"]],
  ["two asks keep both reasons", [v("ask", "b"), v("ask", "e")], "ask", ["b", "e"]],
];

for (const [name, input, decision, reasons] of TABLE) {
  test(`merge: ${name}`, () => {
    const m = mergeVerdicts(input);
    assert.equal(m.decision, decision);
    assert.deepEqual(
      m.verdicts.map((x) => x.reason),
      reasons,
    );
  });
}

test("merge: input order does not change the result", () => {
  const a = [v("allow", "a"), v("deny", "c"), v("ask", "b")];
  assert.deepEqual(mergeVerdicts(a), mergeVerdicts([...a].reverse().reverse()));
  assert.equal(mergeVerdicts([...a].reverse()).decision, "deny");
});
