import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Store } from "../core/index.ts";
import { scratchDir } from "./scratch.ts";

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

test("276: a bare path where the options object belongs is refused, not read as the default store", () => {
  assert.ok(process.env.SANGSOE_TEST_REAL_HOME, "test/setup-home.ts is not preloaded: run npm test");
  for (const bare of [":memory:", "/tmp/elsewhere.db", null]) {
    assert.throws(() => Store.open(bare as never), /takes options \(\{ path \} or \{ home \}\), not a bare path/);
  }
});

// The two below run the guard in a process of their own whose "real" home is a scratch folder, so
// on a tree without the fix they open a file there and never touch the real store.
const GUARD = fileURLToPath(new URL("./setup-home.ts", import.meta.url));
function inGuardedProcess(script: string): { status: number | null; stderr: string } {
  const realHome = scratchDir("sangsoe-guard-real-");
  mkdirSync(join(realHome, ".local", "share", "sangsoe"), { recursive: true });
  const r = spawnSync(process.execPath, ["--import", GUARD, "--input-type=module", "-e", script], {
    env: { ...process.env, SANGSOE_TEST_REAL_HOME: realHome, HOME: scratchDir("sangsoe-guard-home-"), NODE_OPTIONS: "" },
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr };
}

test("276: a symlink that leads into the real store folder is refused like the folder itself", () => {
  const r = inGuardedProcess(`
    import { symlinkSync } from "node:fs";
    import { join } from "node:path";
    import { DatabaseSync } from "node:sqlite";
    const link = join(process.env.HOME, "link");
    symlinkSync(join(process.env.SANGSOE_TEST_REAL_HOME, ".local", "share", "sangsoe"), link);
    new DatabaseSync(join(link, "sangsoe.db"));
  `);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /test opened the real sangsoe store/);
});

test("276: a node process the test starts carries the guard, without naming it on its command line", () => {
  const r = inGuardedProcess(`
    import { execFileSync } from "node:child_process";
    import { join } from "node:path";
    const db = join(process.env.SANGSOE_TEST_REAL_HOME, ".local", "share", "sangsoe", "sangsoe.db");
    execFileSync(process.execPath, ["-e", "new (require('node:sqlite').DatabaseSync)(process.argv[1])", db], { stdio: ["ignore", "ignore", "inherit"] });
  `);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /test opened the real sangsoe store/);
});
