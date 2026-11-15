import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Decision 267: this repository is public, so the names it must never carry are not written in it,
// not even as the pattern that finds them. The pattern comes from outside: an environment variable
// that CI fills from a repository secret. Nothing here prints the pattern or the text it matched,
// because a public CI log is as public as the tree.
const ENV = "SANGSOE_HYGIENE_PATTERN";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = "test/public-hygiene.test.ts";

type Source = { readonly path: string; readonly text: string };

/** `path:line` of every line the pattern matches. Never the line's text. */
function hits(files: readonly Source[], pattern: RegExp): string[] {
  return files.flatMap((f) => f.text.split("\n").flatMap((line, i) => (pattern.test(line) ? [`${f.path}:${i + 1}`] : [])));
}

/** What a failure says: the count and the places. */
const report = (found: readonly string[]) => `${found.length} line(s) match ${ENV}: ${found.join(", ")}`;

/**
 * Case-insensitive, read without the whitespace around it. Null for a source that can find nothing
 * or everything: a line break inside it (no line holds one, so it would pass falsely), one that is
 * not a regular expression, or one that matches the empty string. The error is dropped: it quotes
 * the source.
 */
function compile(raw: string): RegExp | null {
  const source = raw.trim();
  if (/[\r\n]/.test(source)) return null;
  try {
    const re = new RegExp(source, "i");
    return re.test("") ? null : re;
  } catch {
    return null;
  }
}

/**
 * Every file git tracks, as text. Left out: a file with a NUL byte (binary), and one tracked but
 * gone from the working tree (a local run in the middle of an edit).
 */
function tracked(): Source[] {
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  return paths.flatMap((path) => {
    let text: string;
    try {
      text = readFileSync(join(ROOT, path), "utf8");
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return [];
      throw e;
    }
    return text.includes("\0") ? [] : [{ path, text }];
  });
}

test("B4: the check can fail, and a failure names file:line without the match or the pattern", () => {
  const fixture: Source[] = [
    { path: "docs/a.md", text: "fine\nmentions Hygiene-Fixture-Word here\nfine" },
    { path: "core/b.ts", text: "// HYGIENE-FIXTURE-WORD again" },
    { path: "README.md", text: "nothing" },
  ];
  const pattern = compile("hygiene-fixture-word");
  assert.ok(pattern);
  const found = hits(fixture, pattern);
  assert.deepEqual(found, ["docs/a.md:2", "core/b.ts:1"]);
  const text = report(found);
  assert.equal(text, `2 line(s) match ${ENV}: docs/a.md:2, core/b.ts:1`);
  assert.doesNotMatch(text, /hygiene-fixture-word/i);
  assert.deepEqual(hits(fixture, /never-there/), []);
  assert.equal(compile("("), null, "a broken pattern is refused, not thrown with its source");
  assert.equal(compile("x*"), null, "a pattern that matches the empty string is refused");
  // A secret pasted with its line break would otherwise ask for a line break no line holds, and pass.
  const pasted = compile("  hygiene-fixture-word\n");
  assert.ok(pasted, "the whitespace around a pasted value is dropped");
  assert.deepEqual(hits(fixture, pasted), ["docs/a.md:2", "core/b.ts:1"]);
  assert.equal(compile("one-name\nhygiene-fixture-word"), null, "a pattern with a line break inside is refused: it can match no line");
  assert.equal(compile("  \n"), null);
});

test("B4: the scan reads the real tracked tree: it finds this file's own fixture word and nothing else", () => {
  const files = tracked();
  const paths = new Set(files.map((f) => f.path));
  for (const want of [SELF, "package.json", ".github/workflows/ci.yml"]) assert.ok(paths.has(want), `the scan does not read ${want}`);
  const pattern = compile("hygiene-fixture-word");
  assert.ok(pattern);
  const found = hits(files, pattern);
  assert.ok(found.length >= 3, `the fixture word in ${SELF} was not found: ${found.length} line(s)`);
  assert.deepEqual(found.filter((f) => !f.startsWith(`${SELF}:`)), [], "the made-up fixture word is written elsewhere in the tree");
});

const source = process.env[ENV] ?? "";

test(
  "B4: no tracked file matches the internal-name pattern",
  { skip: source.trim() === "" ? `${ENV} is unset: the pattern lives outside this public repository (CI gets it from a secret)` : false },
  () => {
    const pattern = compile(source);
    // assert.ok with a fixed message: a thrown RegExp error or a diff would print the pattern.
    assert.ok(pattern, `${ENV} is not a usable regular expression (it does not compile, it holds a line break, or it matches the empty string)`);
    const found = hits(tracked(), pattern);
    assert.ok(found.length === 0, report(found));
  },
);
