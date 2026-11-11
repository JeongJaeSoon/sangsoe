import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import type { Host } from "./host.ts";
import {
  type Files,
  installPermissions,
  type PermissionOptions,
  permissionsRow,
  realFiles,
  removePermissions,
  SANGSOE_RULES,
  unifiedDiff,
} from "./permissions.ts";
import { addRules, removeRules } from "./settings-json.ts";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

// A temporary HOME whose ~/.claude is the profile both `claude` and Orca use, unless `orcaHome` says otherwise.
function tempHome(o: { orcaHome?: string | null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-permissions-test-"));
  homes.push(home);
  const claude = join(home, ".claude");
  mkdirSync(claude, { recursive: true });
  const orcaHome = o.orcaHome === undefined ? claude : o.orcaHome;
  const host: Host = {
    env: { HOME: home },
    nodeVersion: "26.13.0",
    exists: existsSync,
    readText: (p) => readFileSync(p, "utf8"),
    run(cmd, args) {
      if (cmd === "orca" && args.join(" ") === "account list --json") {
        if (orcaHome === null) return { code: 1, stdout: "", stderr: "orca is not running" };
        const claudeAccounts =
          orcaHome === claude
            ? { accounts: [], activeAccountId: null, systemDefaultHome: claude }
            : { accounts: [{ id: "p1", home: orcaHome }], activeAccountId: "p1", systemDefaultHome: claude };
        return { code: 0, stdout: JSON.stringify({ ok: true, result: { claude: claudeAccounts } }), stderr: "" };
      }
      return assert.fail(`unexpected ${cmd} ${args.join(" ")}`);
    },
  };
  const settings = join(claude, "settings.json");
  const state = join(home, ".local", "share", "sangsoe", "permissions.json");
  return { home, host, settings, state };
}

const ORIGINAL = `{
  "env": {
    "FOO": "1"
  },
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Read(~/notes/**)"
    ],
    "deny": [
      "Bash(rm:*)"
    ]
  },
  "model": "opus"
}
`;

const asker = (answer: boolean) => {
  const asked: string[] = [];
  const ask = async (text: string) => {
    asked.push(text);
    return answer;
  };
  return { asked, ask };
};
const opts = (o: Partial<PermissionOptions>): PermissionOptions => ({ scope: "user", cwd: "/nowhere", yes: false, ...o });

test("decision 221: the diff is shown and asked about, y writes, a rerun is a no-op, uninstall restores the file byte for byte", async () => {
  const t = tempHome();
  writeFileSync(t.settings, ORIGINAL);
  const yes = asker(true);
  const r = await installPermissions(t.host, opts({ ask: yes.ask }));
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(yes.asked.length, 1);
  const shown = yes.asked[0] ?? "";
  assert.match(shown, new RegExp(`^--- ${t.settings}\n\\+\\+\\+ ${t.settings}\n@@ `));
  assert.match(shown, /^\+ {6}"Read\(~\/notes\/\*\*\)",$/m, "the old last rule gains a comma");
  assert.match(shown, /^- {6}"Read\(~\/notes\/\*\*\)"$/m);
  assert.match(shown, /^\+ {6}"Bash\(orca search:\*\)"$/m);
  assert.match(shown, new RegExp(`Add these ${SANGSOE_RULES.length} rules\\? \\[y/N\\] $`));

  const after = readFileSync(t.settings, "utf8");
  const parsed = JSON.parse(after);
  assert.deepEqual(Object.keys(parsed), ["env", "permissions", "model"], "key order kept");
  assert.deepEqual(parsed.permissions.allow, ["Bash(git status:*)", "Read(~/notes/**)", ...SANGSOE_RULES]);
  assert.deepEqual(parsed.permissions.deny, ["Bash(rm:*)"]);
  assert.equal(readFileSync(`${t.settings}.sangsoe-backup`, "utf8"), ORIGINAL);
  assert.ok(r.lines.some((l) => l === `permissions: added ${SANGSOE_RULES.length} rules to ${t.settings} (backup ${t.settings}.sangsoe-backup)`), r.lines.join("\n"));
  const owned = JSON.parse(readFileSync(t.state, "utf8"));
  assert.deepEqual(owned.targets[t.settings].rules, SANGSOE_RULES);
  assert.ok(!JSON.stringify(owned).includes("Bash(git status"), "the record names only the rules sangsoe added");

  const again = asker(true);
  const r2 = await installPermissions(t.host, opts({ ask: again.ask }));
  assert.equal(r2.code, 0);
  assert.equal(again.asked.length, 0, "nothing to ask");
  assert.deepEqual(r2.lines, [`permissions: ${t.settings} already has all ${SANGSOE_RULES.length} sangsoe rules; nothing to write`]);
  assert.equal(readFileSync(t.settings, "utf8"), after);

  const u = removePermissions(t.host);
  assert.equal(u.code, 0, u.lines.join("\n"));
  assert.deepEqual(u.lines, [`permissions: removed ${SANGSOE_RULES.length} rules sangsoe added from ${t.settings}`]);
  assert.equal(readFileSync(t.settings, "utf8"), ORIGINAL);
  assert.ok(!existsSync(t.state), "an empty record is deleted");
  assert.deepEqual(removePermissions(t.host).lines, ["permissions: sangsoe added no permission rules"]);
});

test("decision 221: N writes nothing", async () => {
  const t = tempHome();
  writeFileSync(t.settings, ORIGINAL);
  const no = asker(false);
  const r = await installPermissions(t.host, opts({ ask: no.ask }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ["permissions: nothing written"]);
  assert.equal(readFileSync(t.settings, "utf8"), ORIGINAL);
  assert.ok(!existsSync(t.state));
  assert.ok(!existsSync(`${t.settings}.sangsoe-backup`));
});

test("decision 221: malformed JSON is refused with a clear message and nothing is written", async () => {
  const t = tempHome();
  const broken = '{ "permissions": { "allow": [ "Bash(ls:*)", ] }\n';
  writeFileSync(t.settings, broken);
  const yes = asker(true);
  const r = await installPermissions(t.host, opts({ ask: yes.ask }));
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), new RegExp(`permissions: ${t.settings} is not valid JSON \\(.+\\); nothing written. Fix the file, then run sangsoe install --permissions again`));
  assert.equal(yes.asked.length, 0);
  assert.equal(readFileSync(t.settings, "utf8"), broken);
  assert.ok(!existsSync(t.state));
});

test("decision 221: without a terminal and without --yes it shows the diff and writes nothing; --yes writes", async () => {
  const t = tempHome();
  writeFileSync(t.settings, ORIGINAL);
  const r = await installPermissions(t.host, opts({}));
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /^\+ {6}"mcp__plugin_sangsoe_sangsoe",$/m);
  assert.match(r.lines.at(-1) ?? "", /no terminal to ask on; nothing written.*--yes/);
  assert.equal(readFileSync(t.settings, "utf8"), ORIGINAL);

  const w = await installPermissions(t.host, opts({ yes: true }));
  assert.equal(w.code, 0, w.lines.join("\n"));
  assert.deepEqual(JSON.parse(readFileSync(t.settings, "utf8")).permissions.allow.slice(2), SANGSOE_RULES);
});

test("decision 221: a rule the owner already had is not recorded as sangsoe's and survives uninstall", async () => {
  const t = tempHome();
  const mine = `{\n  "permissions": {\n    "allow": [\n      "Bash(orca search:*)"\n    ]\n  }\n}\n`;
  writeFileSync(t.settings, mine);
  await installPermissions(t.host, opts({ yes: true }));
  assert.equal(JSON.parse(readFileSync(t.state, "utf8")).targets[t.settings].rules.length, SANGSOE_RULES.length - 1);
  // The owner edits one of sangsoe's rules by hand: it is no longer the one sangsoe added.
  const edited = readFileSync(t.settings, "utf8").replace('"Bash(orca worktree set:*)"', '"Bash(orca worktree set --worktree current:*)"');
  writeFileSync(t.settings, edited);
  removePermissions(t.host);
  assert.deepEqual(JSON.parse(readFileSync(t.settings, "utf8")).permissions.allow, ["Bash(orca search:*)", "Bash(orca worktree set --worktree current:*)"]);
});

test("decision 221: a missing settings.json is created, and uninstall deletes it again", async () => {
  const t = tempHome();
  const yes = asker(true);
  await installPermissions(t.host, opts({ ask: yes.ask }));
  assert.match(yes.asked[0] ?? "", /^--- \/dev\/null\n/);
  assert.deepEqual(JSON.parse(readFileSync(t.settings, "utf8")), { permissions: { allow: [...SANGSOE_RULES] } });
  removePermissions(t.host);
  assert.ok(!existsSync(t.settings));
});

test("decision 221: the user scope writes Orca's profile too when it is another directory; project and local write the project's .claude", async () => {
  const orcaDir = mkdtempSync(join(tmpdir(), "sangsoe-permissions-orca-"));
  homes.push(orcaDir);
  const t = tempHome({ orcaHome: orcaDir });
  writeFileSync(t.settings, ORIGINAL);
  const r = await installPermissions(t.host, opts({ yes: true }));
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(JSON.parse(readFileSync(join(orcaDir, "settings.json"), "utf8")).permissions.allow, SANGSOE_RULES);
  assert.equal(JSON.parse(readFileSync(t.settings, "utf8")).permissions.allow.length, 2 + SANGSOE_RULES.length);

  const project = join(t.home, "repo");
  await installPermissions(t.host, opts({ scope: "project", cwd: project, yes: true }));
  await installPermissions(t.host, opts({ scope: "local", cwd: project, yes: true }));
  assert.ok(existsSync(join(project, ".claude", "settings.json")));
  assert.ok(existsSync(join(project, ".claude", "settings.local.json")));
  assert.equal(Object.keys(JSON.parse(readFileSync(t.state, "utf8")).targets).length, 4);
  const u = removePermissions(t.host);
  assert.equal(u.lines.length, 4, u.lines.join("\n"));
  assert.equal(readFileSync(t.settings, "utf8"), ORIGINAL);
});

test("decision 221: an unreadable Orca answer writes the current profile only and says so", async () => {
  const t = tempHome({ orcaHome: null });
  const r = await installPermissions(t.host, opts({ yes: true }));
  assert.match(r.lines[0] ?? "", /cannot read `orca account list --json`.*only .*\.claude is written/);
  assert.ok(existsSync(t.settings));
});

test("decision 221: a symlinked settings.json stays a symlink and its target gets the rules", async () => {
  const t = tempHome();
  const real = join(t.home, "dotfiles-settings.json");
  writeFileSync(real, ORIGINAL);
  symlinkSync(real, t.settings);
  await installPermissions(t.host, opts({ yes: true }));
  assert.ok(lstatSync(t.settings).isSymbolicLink());
  assert.equal(JSON.parse(readFileSync(real, "utf8")).permissions.allow.length, 2 + SANGSOE_RULES.length);
});

// Each shape the splice meets: add then remove gives back the same bytes.
for (const [name, text] of [
  ["an empty object", "{}"],
  ["an empty object with a newline", "{}\n"],
  ["no permissions key", '{\n  "model": "opus"\n}\n'],
  ["permissions without allow", '{\n  "permissions": {\n    "deny": []\n  }\n}\n'],
  ["an empty allow", '{\n  "permissions": {\n    "allow": []\n  }\n}\n'],
  ["no final newline", '{\n  "permissions": {\n    "allow": [\n      "X"\n    ]\n  }\n}'],
  ["tab indentation", '{\n\t"permissions": {\n\t\t"allow": [\n\t\t\t"X"\n\t\t]\n\t}\n}\n'],
  ["a one-line allow", '{ "permissions": { "allow": ["X", "Y"] }, "z": 1 }\n'],
  ["escapes in strings", '{\n  "permissions": {\n    "allow": [\n      "Bash(echo \\"]\\":*)"\n    ]\n  }\n}\n'],
] as const) {
  test(`decision 221: splicing into ${name} round-trips`, () => {
    const added = addRules(text, SANGSOE_RULES);
    assert.ok(added, "the splice parses to the expected object");
    const before = JSON.parse(text);
    const after = JSON.parse(added.text);
    assert.deepEqual(after.permissions.allow, [...(before.permissions?.allow ?? []), ...SANGSOE_RULES]);
    const back = removeRules(added.text, new Set(SANGSOE_RULES), added.created, added.inner);
    assert.equal(back?.text, text);
  });
}

test("decision 221: a change made while the question is open is kept and nothing is written over it", async () => {
  const t = tempHome();
  writeFileSync(t.settings, '{\n  "model": "opus"\n}\n');
  const edited = '{\n  "model": "opus",\n  "theme": "dark"\n}\n';
  const r = await installPermissions(
    t.host,
    opts({
      ask: async () => {
        writeFileSync(t.settings, edited);
        return true;
      },
    }),
  );
  assert.equal(r.code, 1);
  assert.match(r.lines.at(-1) ?? "", /changed while sangsoe was asking\. Run sangsoe install --permissions again; nothing written to it$/);
  assert.equal(readFileSync(t.settings, "utf8"), edited);
  assert.ok(!existsSync(t.state));
});

test("decision 221: whitespace inside an empty container comes back on uninstall", async () => {
  for (const text of ["{ }\n", '{\n  "permissions": {\n    "allow": [ ]\n  }\n}\n', '{\n  "permissions": { }\n}\n', "{\n}\n"]) {
    const t = tempHome();
    writeFileSync(t.settings, text);
    await installPermissions(t.host, opts({ yes: true }));
    removePermissions(t.host);
    assert.equal(readFileSync(t.settings, "utf8"), text);
  }
});

test("decision 221: uninstall takes one copy of a rule; a copy the owner added later stays", async () => {
  const t = tempHome();
  writeFileSync(t.settings, ORIGINAL);
  await installPermissions(t.host, opts({ yes: true }));
  const settings = JSON.parse(readFileSync(t.settings, "utf8"));
  settings.permissions.allow.push("Bash(orca search:*)");
  writeFileSync(t.settings, `${JSON.stringify(settings, null, 2)}\n`);
  removePermissions(t.host);
  assert.deepEqual(JSON.parse(readFileSync(t.settings, "utf8")).permissions.allow, ["Bash(git status:*)", "Read(~/notes/**)", "Bash(orca search:*)"]);
});

test("decision 221: a dangling symlink is followed, not replaced", async () => {
  const t = tempHome();
  const real = join(t.home, "dotfiles", "settings.json");
  symlinkSync(real, t.settings);
  const r = await installPermissions(t.host, opts({ yes: true }));
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.ok(lstatSync(t.settings).isSymbolicLink());
  assert.deepEqual(JSON.parse(readFileSync(real, "utf8")).permissions.allow, SANGSOE_RULES);
});

test("decision 221: a write that fails rolls the record back; a record out of shape removes nothing and throws nothing", async () => {
  const t = tempHome();
  writeFileSync(t.settings, ORIGINAL);
  const files: Files = {
    ...realFiles,
    write: (p, text, o) => (p === t.settings ? assert.fail("EACCES: read-only") : realFiles.write(p, text, o)),
  };
  const r = await installPermissions(t.host, opts({ yes: true, files }));
  assert.equal(r.code, 1);
  assert.match(r.lines.at(-1) ?? "", /cannot be written \(.*EACCES.*\); nothing written to it$/);
  assert.ok(!existsSync(t.state), "no rule is recorded as added");
  assert.equal(readFileSync(t.settings, "utf8"), ORIGINAL);

  mkdirSync(dirname(t.state), { recursive: true });
  writeFileSync(t.state, JSON.stringify({ targets: { [t.settings]: { rules: "x", created: [] } } }));
  const u = removePermissions(t.host);
  assert.equal(u.code, 1);
  assert.match(u.lines[0] ?? "", /is not in its shape\); no rule removed$/);
});

test("decision 221: a permissions value of the wrong type is refused", () => {
  assert.equal(addRules('{ "permissions": [] }', ["X"]), undefined);
  assert.equal(addRules('{ "permissions": { "allow": "X" } }', ["Y"]), undefined);
});

test("decision 221: the diff hunks carry three lines of context", () => {
  const d = unifiedDiff("/s", "a\nb\nc\nd\ne\nf\ng\n", "a\nb\nc\nd\nE\nf\ng\n");
  assert.equal(d, "--- /s\n+++ /s\n@@ -2,6 +2,6 @@\n b\n c\n d\n-e\n+E\n f\n g");
});

test("decision 221: doctor's row counts the rules present", () => {
  const m = SANGSOE_RULES.length;
  assert.deepEqual(permissionsRow("/p/settings.json", { permissions: { allow: [...SANGSOE_RULES] } }), { all: true, detail: `${m} of ${m} sangsoe rules present in /p/settings.json` });
  assert.deepEqual(permissionsRow("/p/settings.json", { permissions: { allow: [SANGSOE_RULES[0]] } }), { all: false, detail: `1 of ${m} sangsoe rules present in /p/settings.json` });
  assert.equal(permissionsRow("/p/settings.json", undefined).detail, `0 of ${m} sangsoe rules present in /p/settings.json (missing or not JSON)`);
});

test("decision 221: the README's install step quotes the current rule count", () => {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const m = SANGSOE_RULES.length;
  for (const quote of [`0 of ${m} sangsoe rules present`, `Add these ${m} rules? [y/N]`, `${m} of ${m} sangsoe rules present`]) assert.ok(readme.includes(quote), quote);
});

test("decision 221: the rules are narrow: no push, merge, rm, brew, or bare orca/sangsoe Bash", () => {
  // Orca verbs that open a session or a worktree stay out: sessions start only through start_unit.
  const orchestration = /^(ask|send|reply|inbox|run-create|run-use|task-list|task-update|worker-list|worker-release)$/;
  for (const r of SANGSOE_RULES) {
    if (r === "mcp__plugin_sangsoe_sangsoe") continue;
    const m = /^Bash\(orca (orchestration ([a-z-]+)|worktree (set|show|list)|reference list|search):\*\)$/.exec(r);
    assert.ok(m, r);
    if (m[2] !== undefined) assert.match(m[2], orchestration, r);
  }
});
