import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { AUTO_COMPACT_ENV, AUTO_COMPACT_WINDOW, autoCompactRow, classifyWindow, installAutoCompact } from "./auto-compact.ts";
import type { Host } from "./host.ts";
import { setEnvValue } from "./settings-json.ts";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

// A temporary HOME with ~/.claude as the current profile and, when `orca` is set, a second Orca profile.
function tempHome(o: { orca?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "sangsoe-autocompact-test-"));
  homes.push(home);
  const claude = join(home, ".claude");
  const orcaDir = join(home, "orca-profile");
  mkdirSync(claude, { recursive: true });
  mkdirSync(orcaDir, { recursive: true });
  const host: Host = {
    env: { HOME: home },
    nodeVersion: "26.13.0",
    exists: existsSync,
    readText: (p) => readFileSync(p, "utf8"),
    run(cmd, args) {
      if (cmd === "orca" && args.join(" ") === "account list --json") {
        const c = o.orca
          ? { accounts: [{ id: "p1", home: orcaDir }], activeAccountId: "p1", systemDefaultHome: claude }
          : { accounts: [], activeAccountId: null, systemDefaultHome: claude };
        return { code: 0, stdout: JSON.stringify({ ok: true, result: { claude: c } }), stderr: "" };
      }
      return assert.fail(`unexpected ${cmd} ${args.join(" ")}`);
    },
  };
  return { host, current: join(claude, "settings.json"), orca: join(orcaDir, "settings.json") };
}

const BEFORE = `{
  "model": "opus",
  "env": {
    "FOO": "1",
    "${AUTO_COMPACT_ENV}": "350000",
    "BAR": "2"
  },
  "permissions": { "allow": ["Bash(ls:*)"] }
}
`;
const withWindow = (v: string) => `{ "env": { "${AUTO_COMPACT_ENV}": "${v}" } }\n`;
const asker = (answer: boolean) => {
  const asked: string[] = [];
  return {
    asked,
    ask: async (text: string) => {
      asked.push(text);
      return answer;
    },
  };
};

test("decision 264: the constant is 600000", () => {
  assert.equal(AUTO_COMPACT_WINDOW, 600000);
});

test("setEnvValue replaces one value in place and leaves every other byte alone", () => {
  assert.equal(setEnvValue(BEFORE, AUTO_COMPACT_ENV, "600000"), BEFORE.replace('"350000"', '"600000"'));
});

test("setEnvValue appends to an existing env, creates a missing env, and refuses an env that is not an object", () => {
  assert.equal(setEnvValue('{\n  "env": {\n    "A": "1"\n  }\n}\n', "K", "9"), '{\n  "env": {\n    "A": "1",\n    "K": "9"\n  }\n}\n');
  assert.equal(setEnvValue('{\n  "model": "x"\n}\n', "K", "9"), '{\n  "model": "x",\n  "env": {\n    "K": "9"\n  }\n}\n');
  assert.equal(setEnvValue("{}\n", "K", "9"), '{\n  "env": {\n    "K": "9"\n  }\n}\n');
  assert.equal(setEnvValue('{ "env": [] }', "K", "9"), undefined);
  assert.equal(setEnvValue("{ broken", "K", "9"), undefined);
});

test("classifyWindow: missing, lower, equal, higher, and a value that is not a number", () => {
  const of = (v: unknown) => classifyWindow({ env: { [AUTO_COMPACT_ENV]: v } }).state;
  assert.equal(classifyWindow({}).state, "missing");
  assert.equal(classifyWindow(undefined).state, "missing");
  assert.equal(of("350000"), "lower");
  assert.equal(of(350000), "lower");
  assert.equal(of("600000"), "equal");
  assert.equal(of("900000"), "higher");
  assert.equal(of("abc"), "invalid");
  assert.equal(of(""), "invalid");
});

test("autoCompactRow passes equal and higher, and names the value otherwise", () => {
  const row = (v: string) => autoCompactRow("/p/settings.json", JSON.parse(withWindow(v)));
  assert.equal(row("600000").ok, true);
  assert.equal(row("900000").ok, true);
  assert.deepEqual(row("350000"), { ok: false, detail: `/p/settings.json: 350000, below ${AUTO_COMPACT_WINDOW}` });
  assert.equal(autoCompactRow("/p/settings.json", {}).ok, false);
  assert.match(autoCompactRow("/p/settings.json", undefined).detail, /\(missing or not JSON\)/);
});

test("decision 264: without --yes the diff is shown and a y writes, with a backup and every other key intact", async () => {
  const t = tempHome();
  writeFileSync(t.current, BEFORE);
  const yes = asker(true);
  const r = await installAutoCompact(t.host, { yes: false, ask: yes.ask });
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(yes.asked.length, 1);
  assert.match(yes.asked[0] ?? "", /-.*"350000"/);
  assert.match(yes.asked[0] ?? "", /\+.*"600000"/);
  assert.equal(readFileSync(t.current, "utf8"), BEFORE.replace('"350000"', '"600000"'));
  assert.equal(readFileSync(`${t.current}.sangsoe-backup`, "utf8"), BEFORE);
  assert.ok(r.lines.some((l) => l === `auto-compact: ${t.current}: 350000 -> 600000`), r.lines.join("\n"));
});

test("an answer of no, or no terminal and no --yes, writes nothing and prints the --yes line", async () => {
  const t = tempHome();
  writeFileSync(t.current, BEFORE);
  const no = asker(false);
  assert.deepEqual((await installAutoCompact(t.host, { yes: false, ask: no.ask })).lines.at(-1), "auto-compact: nothing written");
  const silent = await installAutoCompact(t.host, { yes: false });
  assert.equal(silent.code, 1);
  assert.equal(silent.lines.at(-1), "auto-compact: no terminal to ask on, so nothing was written. Read the diff above, then run: sangsoe install --auto-compact --yes");
  assert.equal(readFileSync(t.current, "utf8"), BEFORE);
  assert.equal(existsSync(`${t.current}.sangsoe-backup`), false);
});

test("--yes writes both the current and Orca's profile, and creates a missing file", async () => {
  const t = tempHome({ orca: true });
  writeFileSync(t.current, '{ "model": "x" }\n');
  const r = await installAutoCompact(t.host, { yes: true });
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(JSON.parse(readFileSync(t.current, "utf8")).env[AUTO_COMPACT_ENV], "600000");
  assert.equal(JSON.parse(readFileSync(t.current, "utf8")).model, "x");
  assert.deepEqual(JSON.parse(readFileSync(t.orca, "utf8")), { env: { [AUTO_COMPACT_ENV]: "600000" } });
  assert.equal(existsSync(`${t.orca}.sangsoe-backup`), false, "a new file has nothing to back up");
});

test("a value already at or above the window is never rewritten", async () => {
  for (const v of ["600000", "900000"]) {
    const t = tempHome();
    writeFileSync(t.current, withWindow(v));
    const r = await installAutoCompact(t.host, { yes: true });
    assert.equal(r.code, 0);
    assert.equal(readFileSync(t.current, "utf8"), withWindow(v));
    assert.equal(existsSync(`${t.current}.sangsoe-backup`), false);
    assert.match(r.lines.join("\n"), /nothing to write/);
  }
});

test("a settings file that is not valid JSON is refused and left alone", async () => {
  const t = tempHome();
  writeFileSync(t.current, "{ broken");
  const r = await installAutoCompact(t.host, { yes: true });
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /not valid JSON.*nothing written. Fix the file, then run sangsoe install --auto-compact again/);
  assert.equal(readFileSync(t.current, "utf8"), "{ broken");
});
