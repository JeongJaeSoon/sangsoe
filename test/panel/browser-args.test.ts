import assert from "node:assert/strict";
import { test } from "node:test";
import { chromeArgs, KEYCHAIN_FLAGS } from "./browser.ts";

test("headless Chrome is started with a mock keychain and the basic password store", () => {
  assert.deepEqual(KEYCHAIN_FLAGS, ["--use-mock-keychain", "--password-store=basic"]);
  const args = chromeArgs("/tmp/panel", 5000);
  for (const flag of ["--use-mock-keychain", "--password-store=basic"]) assert.ok(args.includes(flag), flag);
});
