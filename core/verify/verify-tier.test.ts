import assert from "node:assert/strict";
import { test } from "node:test";
import { type DiffFile, parseTierConfig, requiredEvidence, type TierConfig, type TierLabel, verifyTier } from "./verify-tier.ts";

const CONFIG: TierConfig = {
  docs_globs: ["docs/", "**/*.md"],
  test_globs: ["test/", "**/*.test.ts"],
  ui_globs: ["web/"],
  v3_globs: ["package.json", "package-lock.json", ".github/", "**/auth/**", "migrations/"],
  protected_paths: ["deploy/", "infra/"],
  owners: ["owner1"],
};

const f = (path: string, patch: string | null = "@@ -1 +1 @@\n-a = 1\n+a = 2", previousPath?: string): DiffFile => ({
  path,
  patch,
  ...(previousPath ? { previousPath } : {}),
});
const label = (name: string, actor: string | null = "someone"): TierLabel => ({ name, actor });
const tierOf = (diff: DiffFile[] | null, labels: TierLabel[] | null = [], config: TierConfig | null = CONFIG) =>
  verifyTier(diff, labels, config).effective;

test("decision 85's table: one file of each class gets its tier", () => {
  const cases: [string, string][] = [
    ["docs/guide.md", "V0"],
    ["README.md", "V0"],
    ["test/land.test.ts", "V1"],
    ["core/x.test.ts", "V1"],
    ["core/land/land.ts", "V2"],
    ["web/page.tsx", "V3"],
    ["package-lock.json", "V3"],
    [".github/workflows/ci.yml", "V3"],
    ["core/auth/token.ts", "V3"],
    ["migrations/0001.sql", "V3"],
    ["deploy/prod.yaml", "V3"],
  ];
  for (const [path, want] of cases) assert.equal(tierOf([f(path)]), want, path);
});

test("the PR's tier is the highest file tier", () => {
  assert.equal(tierOf([f("docs/a.md"), f("test/a.test.ts")]), "V1");
  assert.equal(tierOf([f("docs/a.md"), f("core/a.ts"), f("test/a.test.ts")]), "V2");
  assert.equal(tierOf([f("docs/a.md"), f("web/a.tsx")]), "V3");
});

test("a file on two lists takes the higher one", () => {
  const r = verifyTier([f("docs/example.test.ts")], [], CONFIG);
  assert.equal(r.effective, "V1");
  assert.equal(tierOf([f("web/README.md")]), "V3");
});

test("an unclassified path is V2", () => {
  const r = verifyTier([f("scripts/tool.zig")], [], CONFIG);
  assert.equal(r.effective, "V2");
  assert.match(r.files[0]?.why ?? "", /source change/);
});

test("a diff that could not be read is V3", () => {
  const r = verifyTier(null, [], CONFIG);
  assert.deepEqual([r.computed, r.effective], ["V3", "V3"]);
  assert.match(r.reason, /diff unreadable/);
});

test("a config that could not be read, or misses a list, is V3", () => {
  assert.equal(tierOf([f("docs/a.md")], [], null), "V3");
  assert.equal(parseTierConfig({ docs_globs: [], test_globs: [], ui_globs: [], protected_paths: [] }), null, "v3_globs missing");
  assert.equal(parseTierConfig({ ...CONFIG, docs_globs: "docs/" }), null, "a list that is not a list");
  assert.equal(parseTierConfig("nope"), null);
  assert.deepEqual(parseTierConfig({ ...CONFIG, owners: undefined }), { ...CONFIG, owners: [] }, "owners may be absent");
});

test("labels that could not be read are V3", () => {
  const r = verifyTier([f("docs/a.md")], null, CONFIG);
  assert.deepEqual([r.computed, r.effective, r.accepted], ["V0", "V3", false]);
  assert.match(r.reason, /labels unreadable/);
});

test("a comment-only source change is V2: no parser, so a diff line cannot be told from code", () => {
  assert.equal(tierOf([f("core/a.ts", "@@ -1 +1 @@\n-// old note\n+// new note")]), "V2");
  assert.equal(tierOf([f("core/a.ts", "@@ -1,3 +1,4 @@\n /*\n+/* x */\n run();\n /* end */")]), "V2", "an added */ reopens code");
  assert.equal(tierOf([f("core/a.ts", "@@ -1,3 +1 @@\n-/*\n doDanger();\n-*/")]), "V2", "removing block delimiters");
  assert.equal(tierOf([f("core/a.ts", "@@ -1 +1 @@\n-  * 2;\n+  * 2000;")]), "V2", "a continuation line that starts with *");
  assert.equal(tierOf([f("core/q.ts", "@@ -2 +2 @@\n-// DELETE FROM t\n+// DROP TABLE t")]), "V2", "// inside a template literal");
  assert.equal(tierOf([f("tools/a.py", "@@ -1 +1 @@\n-# old\n+# new")]), "V2");
  assert.equal(tierOf([f("core/a.ts", "@@ -1 +1 @@\n-// note\n+const a = 1; // note")]), "V2", "code with a trailing comment");
  assert.equal(tierOf([f("core/a.ts", "@@ -1 +1 @@\n+/* a */ run()")]), "V2", "code after a closed block comment");
  assert.equal(tierOf([f("lib/a.zig", "@@ -1 +1 @@\n-// old\n+// new")]), "V2", "no parser for the language");
  assert.equal(tierOf([f("core/a.ts", null)]), "V2", "a patch GitHub did not return");
  assert.equal(tierOf([f("core/b.ts", "", "core/a.ts")]), "V2", "a rename with no changed line");
});

test("a rename is tiered by both paths", () => {
  assert.equal(tierOf([f("core/a.ts", "@@ -1 +1 @@\n-// a\n+// b", "deploy/a.ts")]), "V3");
  assert.equal(tierOf([f("docs/a.md", "@@ -1 +1 @@\n-a\n+b", "core/a.ts")]), "V2");
});

test("refactor: V1 when no test and no dependency or config file changed, V2 when the rule is broken", () => {
  const refactor = [label("refactor")];
  assert.equal(tierOf([f("core/a.ts"), f("docs/a.md")], refactor), "V1");
  const withTest = verifyTier([f("core/a.ts"), f("test/a.test.ts")], refactor, CONFIG);
  assert.equal(withTest.effective, "V2");
  assert.match(withTest.reason, /refactor label void: test file test\/a\.test\.ts changed/);
  assert.equal(tierOf([f("test/a.test.ts")], refactor), "V2", "tests-only under a broken refactor label is lifted to V2");
  assert.equal(tierOf([f("core/a.ts"), f("package.json")], refactor), "V3", "a manifest keeps its own V3");
});

test("verify-tier:N raises for anyone", () => {
  const r = verifyTier([f("docs/a.md")], [label("verify-tier:2", "stranger")], CONFIG);
  assert.deepEqual([r.computed, r.requested, r.effective, r.accepted], ["V0", "V2", "V2", true]);
});

test("verify-tier:N lowers only for an owner", () => {
  const byOwner = verifyTier([f("core/a.ts")], [label("verify-tier:0", "OWNER1")], CONFIG);
  assert.deepEqual([byOwner.requested, byOwner.effective, byOwner.accepted], ["V0", "V0", true]);
  const byOther = verifyTier([f("core/a.ts")], [label("verify-tier:0", "someone")], CONFIG);
  assert.deepEqual([byOther.requested, byOther.effective, byOther.accepted], ["V0", "V2", false]);
  assert.match(byOther.reason, /lowering by someone ignored: not in owners/);
  const unknown = verifyTier([f("core/a.ts")], [label("verify-tier:1", null)], CONFIG);
  assert.equal(unknown.effective, "V2", "a label whose author is unknown cannot lower");
});

test("a raise and a lower together: the raise wins", () => {
  const r = verifyTier([f("core/a.ts")], [label("verify-tier:1", "owner1"), label("verify-tier:3", "someone")], CONFIG);
  assert.deepEqual([r.requested, r.effective], ["V3", "V3"]);
});

test("protected_paths keep V3 under any label", () => {
  const r = verifyTier([f("infra/main.tf")], [label("verify-tier:0", "owner1")], CONFIG);
  assert.deepEqual([r.requested, r.effective, r.accepted], ["V0", "V3", false]);
  assert.match(r.reason, /protected_paths keep V3/);
});

test("an empty diff is V0", () => {
  assert.equal(tierOf([]), "V0");
});

test("required evidence kinds per tier", () => {
  assert.deepEqual(requiredEvidence(verifyTier([f("docs/a.md")], [], CONFIG)), []);
  assert.deepEqual(requiredEvidence(verifyTier([f("test/a.test.ts")], [], CONFIG)), ["test"]);
  assert.deepEqual(requiredEvidence(verifyTier([f("core/a.ts")], [], CONFIG)), ["test", "run"]);
  assert.deepEqual(requiredEvidence(verifyTier([f("web/a.tsx")], [], CONFIG)), ["test", "run", "ui"]);
  assert.deepEqual(requiredEvidence(verifyTier([f("web/a.tsx"), f("deploy/a.yaml")], [], CONFIG)), ["test", "run", "ui", "dev"]);
  assert.deepEqual(requiredEvidence(verifyTier([f("core/a.ts")], [label("verify-tier:3")], CONFIG)), ["test", "run", "dev"]);
  assert.deepEqual(requiredEvidence(verifyTier(null, [], CONFIG)), ["test", "run", "dev"]);
});

test("verify_tier is pure: the same input gives the same output", () => {
  const diff = [f("core/a.ts"), f("web/b.tsx")];
  const labels = [label("verify-tier:1", "owner1")];
  assert.deepEqual(verifyTier(diff, labels, CONFIG), verifyTier(diff, labels, CONFIG));
});
