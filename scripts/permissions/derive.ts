// Decision 265: reads what sangsoe runs and returns the permissions.allow rules that cover it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Entry, GH_POLICY, ORCA_POLICY, OTHER_EXEC, SANGSOE_POLICY, STATE_PATHS } from "./policy.ts";

export type Origin = "prose" | "table" | "session" | "exec";
export type Hit = { path: string; file: string; line: number; origin: Origin };
export type Derived = {
  /** The rules, sorted; `{HOME}` stays a placeholder. `source` is the first file that needs it, or the declared reason. */
  rules: { rule: string; source: string }[];
  /** Every hit with its line, for `--explain`. */
  hits: Hit[];
  /** Commands a source runs that the policy table does not classify. */
  unclassified: Hit[];
  /** Policy entries nothing in the sources runs (a stale deny, in-process or declared-free allow). */
  stale: string[];
  /** `gh`/`git` literals and orca literals outside ORCA_COMMANDS the policy does not name. */
  unlisted: { key: string; file: string; line: number }[];
};

/** Files that hold what a session is told to run: skills and agents (evals hold test prompts, not instructions). */
const PROSE_DIRS = ["claude-plugin/skills", "claude-plugin/agents"];
/** Core files whose strings are injected into a session's context. */
const SESSION_TEXT = ["core/session/session-start.ts"];
const TABLE_FILE = "core/orca/commands.ts";
const CODE_DIRS = ["core", "cli", "orca-plugin", "claude-plugin/mcp"];
const STATE_DIRS = [...CODE_DIRS, "claude-plugin"];

function walk(root: string, dir: string, keep: (rel: string) => boolean, out: string[] = []): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "vendor" || e.name === "evals" || e.name.startsWith(".")) continue;
      walk(root, rel, keep, out);
    } else if (keep(rel)) out.push(rel);
  }
  return out;
}

const isTest = (p: string) => /\.test\.ts$/.test(p);
const codeFiles = (root: string, dirs: string[]) => dirs.flatMap((d) => walk(root, d, (p) => p.endsWith(".ts") && !isTest(p)));

const WORD = /^[a-z][a-z0-9-]*$/;

/** Policy keyed by the whole command: `orca status`, `gh pr view`. */
const POLICY: Readonly<Record<string, Entry>> = {
  ...Object.fromEntries(Object.entries(ORCA_POLICY).map(([k, v]) => [`orca ${k}`, v])),
  ...Object.fromEntries(Object.entries(GH_POLICY).map(([k, v]) => [`gh ${k}`, v])),
  ...Object.fromEntries(Object.entries(SANGSOE_POLICY).map(([k, v]) => [`sangsoe ${k}`, v])),
};

/** The longest prefix of the words after `tool` that the policy names, else the first two words. A hit's path is the whole command. */
function commandPath(tool: string, words: string[]): { path: string; known: boolean } {
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const p = `${tool} ${words.slice(0, n).join(" ")}`;
    if (p in POLICY) return { path: p, known: true };
  }
  return { path: `${tool} ${words.slice(0, 2).join(" ")}`, known: false };
}

function leadingWords(text: string): string[] {
  const words: string[] = [];
  for (const t of text.trim().split(/\s+/)) {
    // A closing quote, backtick or punctuation ends the command: "run `sangsoe item new` and".
    const bare = t.replace(/[`'".,;:)]+$/, "");
    if (!WORD.test(bare)) break;
    words.push(bare);
    if (bare !== t) break;
  }
  return words;
}

/** `orca <words>` in every code span and fenced line of a markdown file. */
function proseHits(file: string, text: string, origin: Origin): Hit[] {
  const hits: Hit[] = [];
  let fenced = false;
  text.split("\n").forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      return;
    }
    const spans = fenced ? [raw] : [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
    for (const span of spans) {
      for (const m of span.matchAll(/(?:^|[\s("'=;|&])(orca|gh|sangsoe)\s+([^\n]*)/g)) {
        const words = leadingWords(m[2] ?? "");
        if (words.length > 0) hits.push({ path: commandPath(m[1] ?? "", words).path, file, line: i + 1, origin });
      }
    }
    // The skills' shorthand `Orca \`send\`` always means an orchestration subcommand (test/spec-names.test.ts checks the verb exists).
    for (const m of raw.matchAll(/\bOrca\s+`([a-z][a-z0-9-]*)/g)) hits.push({ path: `orca orchestration ${m[1]}`, file, line: i + 1, origin });
  });
  return hits;
}

/** `orca <words>` anywhere on a line of a source file whose strings a session reads. */
function sessionHits(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  text.split("\n").forEach((raw, i) => {
    for (const m of raw.matchAll(/\borca\s+([a-z][^\n]*)/g)) {
      const words = leadingWords(m[1] ?? "");
      if (words.length > 0) hits.push({ path: commandPath("orca", words).path, file, line: i + 1, origin: "session" });
    }
  });
  return hits;
}

/**
 * `sangsoe <words>` on a line of a gate's or the session start's text. English prose says "sangsoe made",
 * so only a command the policy names counts here (a skill's code span reports an unknown one).
 */
function sangsoeTextHits(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  text.split("\n").forEach((raw, i) => {
    for (const m of raw.matchAll(/\bsangsoe\s+([a-z][^\n]*)/g)) {
      const words = leadingWords(m[1] ?? "");
      const c = commandPath("sangsoe", words);
      if (words.length > 0 && c.known) hits.push({ path: c.path, file, line: i + 1, origin: "session" });
    }
  });
  return hits;
}

/** Each `path: ["a", "b"]` row of the adapter table. */
function tableHits(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  text.split("\n").forEach((raw, i) => {
    const m = raw.match(/\bpath:\s*\[((?:"[^"]+"(?:,\s*)?)+)\]/);
    if (m) hits.push({ path: `orca ${[...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]).join(" ")}`, file, line: i + 1, origin: "table" });
  });
  return hits;
}

/** Literal `"orca", ["a", "b", …]` and `"gh"|"git", […]` argument lists on one line. */
function execLiterals(text: string): { cmd: string; words: string[]; line: number }[] {
  const out: { cmd: string; words: string[]; line: number }[] = [];
  text.split("\n").forEach((raw, i) => {
    // `exec("orca", [` and the helper form `step("orca", \`text\`, [`: the first list after the command word.
    for (const m of raw.matchAll(/"(orca|gh|git)"[^[\n]*\[([^\]]*)\]/g)) {
      const args = m[2] ?? "";
      const literals = [...args.matchAll(/"([^"]*)"|[^,\s][^,]*/g)].map((a) => (a[1] !== undefined ? a[1] : null));
      const leading: string[] = [];
      for (const l of literals) {
        if (l === null) {
          if (m[1] === "orca") break;
          continue;
        }
        if (l.startsWith("-")) {
          if (m[1] === "orca") break;
          continue;
        }
        leading.push(l);
        if (m[1] !== "orca") break;
      }
      if (leading.length > 0) out.push({ cmd: m[1] ?? "", words: leading, line: i + 1 });
    }
  });
  return out;
}

function ruleFor(path: string, e: Entry): string | undefined {
  if (e.kind === "allow") return `Bash(${path}:*)`;
  if (e.kind === "handle") return `Bash(${path} ${e.flag} ${e.prefix}*)`;
  return undefined;
}

export function derive(root: string): Derived {
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const hits: Hit[] = [];
  for (const f of PROSE_DIRS.flatMap((d) => walk(root, d, (p) => p.endsWith(".md")))) hits.push(...proseHits(f, read(f), "prose"));
  for (const f of SESSION_TEXT) hits.push(...sessionHits(f, read(f)));
  for (const f of [...SESSION_TEXT, ...walk(root, "core/gates", (p) => p.endsWith(".ts") && !isTest(p))]) hits.push(...sangsoeTextHits(f, read(f)));
  hits.push(...tableHits(TABLE_FILE, read(TABLE_FILE)));

  const unclassified: Hit[] = [];
  const unlisted: Derived["unlisted"] = [];
  for (const f of codeFiles(root, CODE_DIRS)) {
    for (const lit of execLiterals(read(f))) {
      if (lit.cmd === "orca") {
        const { path, known } = commandPath("orca", lit.words);
        if (known) hits.push({ path, file: f, line: lit.line, origin: "exec" });
        else unlisted.push({ key: path, file: f, line: lit.line });
      } else {
        const key = `${lit.cmd} ${lit.words[0]}`;
        if (!(key in OTHER_EXEC)) unlisted.push({ key, file: f, line: lit.line });
      }
    }
  }
  for (const h of hits) if (!(h.path in POLICY)) unclassified.push(h);

  const used = new Map<string, Hit[]>();
  for (const h of hits) used.set(h.path, [...(used.get(h.path) ?? []), h]);

  const rules: Derived["rules"] = [];
  const stale: string[] = [];
  for (const [path, e] of Object.entries(POLICY)) {
    // A literal exec runs in sangsoe's process, so it proves an in-process entry but not that a session types the command.
    const found = (used.get(path) ?? []).filter((h) => h.origin !== "exec" || e.kind === "inprocess");
    const declared = e.kind === "allow" || e.kind === "handle" ? e.declared : undefined;
    const first = found[0];
    if (!first && !declared) stale.push(path);
    else if (first && declared) stale.push(`${path} (declared, but ${first.file} names it: drop the declaration)`);
    const rule = ruleFor(path, e);
    if (!rule) continue;
    if (first) rules.push({ rule, source: first.file });
    else if (declared) rules.push({ rule, source: `declared: ${declared}` });
  }
  const plugin = JSON.parse(read("claude-plugin/.claude-plugin/plugin.json")) as { name: string };
  const mcp = JSON.parse(read("claude-plugin/.mcp.json")) as { mcpServers: Record<string, unknown> };
  for (const server of Object.keys(mcp.mcpServers)) rules.push({ rule: `mcp__plugin_${plugin.name}_${server}`, source: "claude-plugin/.mcp.json" });

  const stateFiles = codeFiles(root, STATE_DIRS).concat(PROSE_DIRS.flatMap((d) => walk(root, d, (p) => p.endsWith(".md"))));
  for (const s of STATE_PATHS) {
    const file = stateFiles.find((f) => read(f).includes(s.root));
    if (file) rules.push({ rule: s.rule, source: file });
    else stale.push(s.root);
  }
  rules.sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  return { rules, hits, unclassified, stale, unlisted };
}

/** The text of core/install/permissions.generated.ts. */
export function renderGenerated(d: Derived): string {
  const rows = d.rules.map((r) => `  { rule: ${JSON.stringify(r.rule)}, source: ${JSON.stringify(r.source)} },`).join("\n");
  return `// Generated by scripts/gen-permissions.ts from what sangsoe runs (decision 265); do not edit by hand.
// \`source\` is the first file that runs the command, or why no sangsoe file names it. \`{HOME}\` is
// resolved from the installing HOME, so no machine path is kept here.
export const GENERATED_RULES: readonly { readonly rule: string; readonly source: string }[] = [
${rows}
];
`;
}
