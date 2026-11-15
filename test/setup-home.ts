// Preloaded into every test process (`node --import`, see package.json "test").
// A test must never reach the real store: a build that knows a newer schema upgrades it in place,
// and the installed release then cannot open it. HOME points at a throwaway folder, and a database
// opened anywhere under the real ~/.local/share/sangsoe throws.
import { mkdtempSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);

if (!process.env.SANGSOE_TEST_REAL_HOME) {
  const real = homedir();
  const fake = mkdtempSync(join(tmpdir(), "sangsoe-test-home-"));
  process.env.SANGSOE_TEST_REAL_HOME = real;
  process.env.HOME = fake;
}

// A node process a test starts gets the same guard (decision 276): the pinned HOME alone does not
// stop a child that is handed a path. The file URL has no space to quote.
const preload = `--import ${import.meta.url}`;
if (!(process.env.NODE_OPTIONS ?? "").includes(preload)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} ${preload}`.trim();

/** The path with every symlink resolved, also when its last parts do not exist yet. */
function canonical(path: string): string {
  const rest: string[] = [];
  let at = resolve(path);
  for (;;) {
    try {
      return join(realpathSync(at), ...rest);
    } catch {
      const up = dirname(at);
      if (up === at) return resolve(path);
      rest.unshift(basename(at));
      at = up;
    }
  }
}

const real = process.env.SANGSOE_TEST_REAL_HOME as string;
const guarded = canonical(join(real, ".local", "share", "sangsoe"));

const sqlite = require("node:sqlite") as { DatabaseSync: new (path: string, opts?: unknown) => unknown };
const Real = sqlite.DatabaseSync;
sqlite.DatabaseSync = class extends (Real as new (path: string, opts?: unknown) => object) {
  constructor(...args: [string, unknown?]) {
    const path = args[0];
    if (typeof path === "string" && path !== ":memory:") {
      const p = canonical(path);
      if (p === guarded || p.startsWith(guarded + sep)) {
        throw new Error(`test opened the real sangsoe store (${p}); pass { path } or { home } pointing at a temp folder`);
      }
    }
    super(...args);
  }
} as never;
require("node:module").syncBuiltinESMExports();
