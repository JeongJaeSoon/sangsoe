import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import { Store } from "../core/index.ts";

// Guard: without test/setup-home.ts preloaded these fail before anything is opened, so running this
// file bare never touches the real store.

test("the test run has its HOME pinned away from the real one", () => {
  const real = process.env.SANGSOE_TEST_REAL_HOME;
  assert.ok(real, "test/setup-home.ts is not preloaded: run npm test");
  assert.notEqual(homedir(), real);
});

test("opening the real default store path throws instead of opening it", () => {
  const real = process.env.SANGSOE_TEST_REAL_HOME;
  assert.ok(real, "test/setup-home.ts is not preloaded: run npm test");
  assert.throws(() => Store.open({ home: real }), /real sangsoe store/);
});

test("a string path where an options object belongs lands in the pinned HOME, not the real one", () => {
  assert.ok(process.env.SANGSOE_TEST_REAL_HOME, "test/setup-home.ts is not preloaded: run npm test");
  const s = Store.open(":memory:" as never);
  s.close?.();
});
