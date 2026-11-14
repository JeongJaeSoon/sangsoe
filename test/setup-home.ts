// Preloaded into every test process (`node --import`, see package.json "test").
// A test must never reach the real store: a build that knows a newer schema upgrades it in place,
// and the installed release then cannot open it. HOME points at a throwaway folder, and a database
// opened anywhere under the real ~/.local/share/sangsoe throws.
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);

if (!process.env.SANGSOE_TEST_REAL_HOME) {
  const real = homedir();
  const fake = mkdtempSync(join(tmpdir(), "sangsoe-test-home-"));
  process.env.SANGSOE_TEST_REAL_HOME = real;
  process.env.HOME = fake;
}

const real = process.env.SANGSOE_TEST_REAL_HOME as string;
const guarded = resolve(real, ".local", "share", "sangsoe");

const sqlite = require("node:sqlite") as { DatabaseSync: new (path: string, opts?: unknown) => unknown };
const Real = sqlite.DatabaseSync;
sqlite.DatabaseSync = class extends (Real as new (path: string, opts?: unknown) => object) {
  constructor(path: string, opts?: unknown) {
    if (typeof path === "string" && path !== ":memory:") {
      const p = resolve(path);
      if (p === guarded || p.startsWith(guarded + sep)) {
        throw new Error(`test opened the real sangsoe store (${p}); pass { path } or { home } pointing at a temp folder`);
      }
    }
    super(path, opts);
  }
} as never;
require("node:module").syncBuiltinESMExports();
