import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// R-21 (decision 268) is about notes, and notes live outside sangsoe (D-2). The part sangsoe can keep
// is about its own code: the places shipped code deletes data for good (files, Docker resources,
// worktrees, rows of its own store) are listed here with what each removes and why that is allowed.
// The scan finds four spellings: a node:fs delete, a `rm` word handed to an exec (docker's), a call
// of Orca's `worktree rm`, and an SQL `DELETE FROM`. A new removal in one of those spellings fails
// this test until it is moved to the trash or listed with its reason. Another spelling (a shell
// string, another CLI's delete command, an SQL UPDATE that blanks a value as the owner's redaction
// in core/store/store.ts does) is not seen: add its pattern here with it.
// Not counted, because they delete no data: closing a terminal, and unregistering a plugin at
// uninstall (the files it registered are a copy of the release).
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHIPPED = ["core", "cli", "orca-plugin", "claude-plugin"];
const SKIP = new Set(["node_modules", "vendor", "dist"]);

const KINDS = {
  // A call of a node:fs delete, also through a namespace (`fs.rmSync(`, `fs.promises.rm(`).
  fs: /\b(?:rmSync|unlinkSync|rmdirSync|rm|unlink|rmdir)\s*\(/g,
  // `rm` as its own string: an argv word of an exec, or one word of a command path.
  argv: /["'`]rm["'`]/g,
  // A call of Orca's worktree removal (`worktree rm --run-hooks --delete-branch`); its declaration has no dot.
  worktree: /\.worktreeRm\s*\(/g,
  sql: /\bDELETE\s+FROM\b/gi,
} as const;
type Kind = keyof typeof KINDS;

const LISTED: Readonly<Record<string, Partial<Record<Kind, number>> & { why: string }>> = {
  "core/approve/content-hash.ts": { fs: 1, why: "the mkdtemp copy it just made and hashed" },
  "core/approve/ports.ts": { fs: 1, why: "the mkdtemp folder it unpacked the release tarball into" },
  "core/install/doctor.ts": { fs: 1, why: "the mkdtemp folder it unpacked the release tarball into" },
  "core/install/permissions.ts": { fs: 1, why: "sangsoe's own record of the rules it added, or a settings file it created that is empty again; both live from install to uninstall" },
  "core/install/stage.ts": { fs: 2, why: "orca-plugin/vendor, the staged copy of core it builds" },
  "core/reaper/docker.ts": { argv: 1, why: "a container, volume, network or image whose id a session recorded with resource_record (R-12), after the in-use checks; a volume's data goes with it" },
  "core/orca/commands.ts": { argv: 1, why: "the one place Orca's `worktree rm` is spelled; its callers are the two worktree rows below" },
  "core/reaper/round.ts": { worktree: 1, why: "a finished unit's worktree after every REAPER check passed (clean tree; its PR merged or closed, or no PR and its last Dispatch succeeded or was cancelled with HEAD pushed, or the owner confirmed a card with no trace); its branch and the files git ignores go with it, and the repository's archive hook runs" },
  "core/start/local-settings.ts": { fs: 1, why: "the temporary copy of a parent's .claude/settings.local.json it just wrote, when the write or the rename over the real file failed (decision 310)" },
  "core/start/start.ts": { worktree: 1, why: "the worktree a failed start made a moment ago, with its branch, only when its one terminal is the shell the start recorded or it has no terminal at all" },
  "core/store/samples.ts": { sql: 1, why: "sangsoe's own load samples older than 24 hours (decision 241); the event table itself refuses a delete" },
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|js|mjs)$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

test("R-21: every permanent removal in shipped code is a listed one, with what it removes and why", () => {
  const found: Record<string, Partial<Record<Kind, number>>> = {};
  for (const f of SHIPPED.flatMap((d) => sources(join(ROOT, d)))) {
    const text = readFileSync(f, "utf8");
    for (const kind of Object.keys(KINDS) as Kind[]) {
      const n = text.match(KINDS[kind])?.length ?? 0;
      if (n > 0) found[relative(ROOT, f)] = { ...found[relative(ROOT, f)], [kind]: n };
    }
  }
  const listed = Object.fromEntries(Object.entries(LISTED).map(([f, { why: _why, ...kinds }]) => [f, kinds]));
  assert.deepEqual(found, listed);
  for (const [f, v] of Object.entries(LISTED)) assert.ok(v.why.length > 20, `${f}: say what it removes and why`);
});

test("R-21: the scan sees each kind of removal it claims to list", () => {
  const seen = (kind: Kind, text: string) => text.match(KINDS[kind])?.length ?? 0;
  assert.equal(seen("fs", 'rmSync(dir); await fs.promises.rm(p); fs.unlinkSync(q); const form = "rm (x)";'), 4, "a call in any spelling, and it over-matches a string on purpose");
  assert.equal(seen("fs", "const confirm = perform(x); const arm = 1;"), 0);
  assert.equal(seen("argv", 'exec("docker", [kind, "rm", ref]); path: ["worktree", "rm"]'), 2);
  assert.equal(seen("argv", 'const s = "worktree rm fails"; "rmdir"'), 0);
  assert.equal(seen("worktree", "await d.orca.worktreeRm({ worktree }); worktreeRm: (a) => run(); worktreeRm(a: { worktree: string }): Promise<x>;"), 1);
  assert.equal(seen("sql", 'db.prepare("DELETE FROM load_sample WHERE at <= ?"); db.exec(`delete\n  from t`); "BEFORE DELETE ON event"'), 2);
});
