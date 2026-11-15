import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { chromeArgs } from "./browser.ts";

test("headless Chrome is started with a mock keychain and the basic password store", () => {
  const args = chromeArgs("/tmp/panel", 5000);
  assert.ok(args.includes("--use-mock-keychain"));
  assert.ok(args.includes("--password-store=basic"));
});

test("every test file that starts Chrome by hand passes both keychain flags too", () => {
  const dir = new URL("./", import.meta.url);
  for (const f of readdirSync(dir)) {
    if (f === "browser.ts" || f === "browser-args.test.ts") continue;
    const src = readFileSync(new URL(f, dir), "utf8");
    if (!src.includes('"--headless')) continue;
    assert.ok(src.includes('"--use-mock-keychain"') && src.includes('"--password-store=basic"'), `${f} starts Chrome without the keychain flags`);
  }
});
