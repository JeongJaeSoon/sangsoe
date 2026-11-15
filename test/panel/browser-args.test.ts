import assert from "node:assert/strict";
import { test } from "node:test";
import { chromeArgs } from "./browser.ts";

test("headless Chrome is started with a mock keychain and the basic password store", () => {
  const args = chromeArgs("/tmp/panel", 5000);
  assert.ok(args.includes("--use-mock-keychain"));
  assert.ok(args.includes("--password-store=basic"));
  assert.ok(args.includes("--user-data-dir=/tmp/panel/profile"));
});
