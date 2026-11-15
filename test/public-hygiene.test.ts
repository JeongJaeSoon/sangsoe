import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Decision 267: this repository is public, so the names it must never carry are not written in it,
// not even as the pattern that finds them. The pattern comes from outside: an environment variable
// that CI fills from a repository secret. Nothing here prints the pattern or the text it matched,
// because a public CI log is as public as the tree.
const ENV = "SANGSOE_HYGIENE_PATTERN";
const ROOT = new URL("..", import.meta.url).pathname;

type Source = { readonly path: string; readonly text: string };

/** `path:line` of every line the pattern matches. Never the line's text. */
function hits(files: readonly Source[], pattern: RegExp): string[] {
  return files.flatMap((f) => f.text.split("\n").flatMap((line, i) => (pattern.test(line) ? [`${f.path}:${i + 1}`] : [])));
}

/** What a failure says: the count and the places. */
const report = (found: readonly string[]) => `${found.length} line(s) match ${ENV}: ${found.join(", ")}`;

/** Case-insensitive; null when the source is not a regular expression. The error is dropped: it quotes the source. */
function compile(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

/** Every file git tracks, as text; a file with a NUL byte is binary and left out. */
function tracked(): Source[] {
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  return paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") })).filter((f) => !f.text.includes("\0"));
}

test("B4: the check can fail, and a failure names file:line without the match or the pattern", () => {
  const fixture: Source[] = [
    { path: "docs/a.md", text: "fine\nmentions Example-Internal here\nfine" },
    { path: "core/b.ts", text: "// EXAMPLE-INTERNAL again" },
    { path: "README.md", text: "nothing" },
  ];
  const pattern = compile("example-internal");
  assert.ok(pattern);
  const found = hits(fixture, pattern);
  assert.deepEqual(found, ["docs/a.md:2", "core/b.ts:1"]);
  const text = report(found);
  assert.equal(text, `2 line(s) match ${ENV}: docs/a.md:2, core/b.ts:1`);
  assert.doesNotMatch(text, /example-internal/i);
  assert.deepEqual(hits(fixture, /never-there/), []);
  assert.equal(compile("("), null, "a broken pattern is refused, not thrown with its source");
});

const source = process.env[ENV] ?? "";

test(
  "B4: no tracked file matches the internal-name pattern",
  { skip: source === "" ? `${ENV} is unset: the pattern lives outside this public repository (CI gets it from a secret)` : false },
  () => {
    const pattern = compile(source);
    // assert.ok with a fixed message: a thrown RegExp error or a diff would print the pattern.
    assert.ok(pattern, `${ENV} is not a valid regular expression`);
    const found = hits(tracked(), pattern);
    assert.ok(found.length === 0, report(found));
  },
);
