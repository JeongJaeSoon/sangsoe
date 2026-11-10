import assert from "node:assert/strict";
import { test } from "node:test";
import { landAllowDetail, landAllowRules } from "./land-allowed.ts";

test("decision 198: the allow rules that let sangsoe land through, in either place and either form", () => {
  const s = {
    permissions: { allow: ["Bash(git status:*)", "Bash(sangsoe land:*)", "mcp__plugin_sangsoe_sangsoe__land", "Bash(sangsoe-landing)"] },
    autoMode: { allow: ["Running sangsoe land for a reviewed PR is allowed", "pushing to main"] },
  };
  assert.deepEqual(landAllowRules(s), {
    permissions: ["Bash(sangsoe land:*)", "mcp__plugin_sangsoe_sangsoe__land"],
    autoMode: ["Running sangsoe land for a reviewed PR is allowed"],
  });
  for (const r of ["Bash(sangsoe:*)", "Bash(sangsoe *)", "Bash(sangsoe land --pr 1)", "mcp__plugin_sangsoe_sangsoe__*"]) {
    assert.equal(landAllowRules({ permissions: { allow: [r] } }).permissions.length, 1, r);
  }
  for (const r of ["Bash(sangsoe doctor)", "Bash(orch land:*)", "mcp__plugin_sangsoe_sangsoe__brief"]) {
    assert.equal(landAllowRules({ permissions: { allow: [r] } }).permissions.length, 0, r);
  }
  assert.deepEqual(landAllowRules({}), { permissions: [], autoMode: [] });
  assert.deepEqual(landAllowRules({ permissions: { allow: "Bash(sangsoe land:*)" } }), { permissions: [], autoMode: [] }, "not a list reads as none");
});

test("the doctor detail says where a rule was found, or that none was; a missing file is not 'none found'", () => {
  assert.equal(landAllowDetail("/p", { permissions: ["x"], autoMode: [] }).found, true);
  assert.match(landAllowDetail("/p", { permissions: [], autoMode: [] }).detail, /no allow rule/);
  assert.match(landAllowDetail("/p", undefined).detail, /missing or not JSON/);
});
