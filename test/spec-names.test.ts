// Design names ↔ code names (program predicate 4). Each category reads its names from the doc that
// owns them and from the code, and every difference must sit in ALLOWED with the decision that
// records it. SPEC_NAMES_REPORT=1 prints the full diff table, allowed rows included.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");
const stems = (dir: string) =>
  readdirSync(`${ROOT}${dir}`)
    .filter((n) => /^[^.]+\.ts$/.test(n))
    .map((n) => n.replace(/\.ts$/, ""));

const glossary = read("docs/glossary.md");
const appendix = read("docs/design-appendix.html");
const design = read("docs/design.html");

function glossarySection(n: number): string {
  const start = glossary.indexOf(`\n## ${n}. `);
  const end = glossary.indexOf("\n## ", start + 1);
  assert.ok(start >= 0, `glossary.md has no section ${n}`);
  return glossary.slice(start, end < 0 ? undefined : end);
}

/** The cells of a Markdown table row; empty for a line that is not a body row. */
function cells(line: string): string[] {
  if (!line.startsWith("|") || /^\|[-| ]+\|$/.test(line)) return [];
  return line.split("|").slice(1, -1);
}

const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
const codes = (s: string) => [...s.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1] ?? "");

/** Drops text inside (), {} and [] so that only the top-level names of a list cell remain. */
function topLevel(s: string): string {
  let depth = 0;
  let out = "";
  for (const ch of s) {
    if ("({[（".includes(ch)) depth++;
    if (depth === 0) out += ch;
    if (")}]）".includes(ch)) depth = Math.max(0, depth - 1);
  }
  return out;
}

function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  assert.ok(start >= 0, `marker not found: ${from}`);
  const end = text.indexOf(to, start + from.length);
  return text.slice(start, end < 0 ? undefined : end);
}

type Category = { name: string; where: string; design: Set<string>; code: Set<string> };

// --- events: appendix "event 이름 전체" (top-level names per writer) and glossary §9 ↔ contract/events
const eventTable = between(appendix, "<h3>event 이름 전체</h3>", "</table>");
const eventDesign = new Set<string>();
for (const row of eventTable.split("<tr>").slice(2)) {
  const cell = row.split("<td>")[2] ?? "";
  if (cell.startsWith("칸 ")) continue; // the "모든 event 공통" row describes a column, not a type
  for (const name of codes(topLevel(cell))) eventDesign.add(name);
}
const eventCode = new Set(stems("core/contract/events"));

// Glossary §9 also names payload fields and reason values; only the names that are an event type on
// either side take part, so the check is: the glossary defines every event the code writes.
const glossaryEvents = new Set<string>();
for (const line of glossarySection(9).split("\n")) {
  const c = cells(line);
  if (c.length < 3 || c[0]?.trim() === "용어") continue;
  for (const t of ticks(c[2] ?? "")) if (eventCode.has(t) || eventDesign.has(t)) glossaryEvents.add(t);
}

// --- views: appendix #schema rows of kind 뷰 ↔ the Views interface
const schema = between(appendix, '<section id="schema">', "</section>");
const viewDesign = new Set<string>();
for (const m of schema.matchAll(/<tr><td><code>([^<]+)<\/code><\/td><td>뷰<\/td>/g)) viewDesign.add(m[1] ?? "");
const viewsSrc = between(read("core/contract/views.ts"), "export interface Views {", "}");
const viewCode = new Set([...viewsSrc.matchAll(/readonly (\w+):/g)].map((m) => m[1] ?? ""));
// The dependency views live in core/graph as camelCase functions (doneBlockers is done_blockers).
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
for (const m of read("core/graph/index.ts").matchAll(/\b([a-z]+[A-Z]\w*)\b/g)) {
  const name = snake(m[1] ?? "");
  if (viewDesign.has(name)) viewCode.add(name);
}

// --- MCP tools: the tools README table ↔ claude-plugin/mcp/tools/*.ts
const toolsReadme = read("claude-plugin/mcp/tools/README.md");
const toolDesign = new Set<string>();
for (const line of toolsReadme.split("\n")) {
  const c = cells(line);
  const first = ticks(c[0] ?? "")[0];
  if (first && /^[a-z_]+$/.test(first)) toolDesign.add(first);
}
const toolCode = new Set(stems("claude-plugin/mcp/tools"));

// --- CLI: glossary §11 `sangsoe …` identifiers ↔ cli/commands (a design row names a command when
// the code has that name; otherwise its first one or two words are the missing command)
const cliCode = new Set(
  readdirSync(`${ROOT}cli/commands`)
    .filter((n) => /^[^.]+\.ts$/.test(n) && !n.includes(".test."))
    .map((n) => n.replace(/\.ts$/, "").replaceAll("-", " ")),
);
cliCode.add("verify-tier");
cliCode.delete("verify tier");
const cliDesign = new Set<string>();
for (const line of glossarySection(11).split("\n")) {
  const c = cells(line);
  for (const t of ticks(c[2] ?? "")) {
    const m = /^sangsoe ([a-z-]+(?: [a-z-]+)?)/.exec(t);
    if (!m?.[1]) continue;
    const words = m[1];
    const one = words.split(" ")[0] ?? words;
    cliDesign.add(cliCode.has(words) ? words : cliCode.has(one) ? one : words);
  }
}
// A command the glossary never names in §11 counts as present when the glossary names it anywhere.
for (const name of cliCode) if (glossary.includes(`sangsoe ${name}`)) cliDesign.add(name);

// --- monitors: glossary §1 monitor row ↔ MONITOR_NAMES; REAPER ↔ core/reaper
const monitorRow = glossarySection(1)
  .split("\n")
  .find((l) => l.startsWith("| monitor |"));
const monitorDesign = new Set(ticks(cells(monitorRow ?? "")[2] ?? "").map((t) => t.replace(/-monitor$/, "")));
if (glossary.includes("| REAPER |")) monitorDesign.add("REAPER");
const monitorSrc = read("core/detect/monitor.ts");
const monitorCode = new Set(
  [...(/MONITOR_NAMES = \[([^\]]+)\]/.exec(monitorSrc)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((m) => m[1] ?? ""),
);
if (readdirSync(`${ROOT}core/reaper`).includes("round.ts")) monitorCode.add("REAPER");

// --- gates: appendix #gates `[gate:x]` ↔ GateName
const gatesSection = between(appendix, '<section id="gates">', "</section>");
const gateDesign = new Set([...gatesSection.matchAll(/\[gate:([a-z-]+)\]/g)].map((m) => m[1] ?? ""));
const gateTypes = /export type GateName = ([^;]+);/.exec(read("core/gates/types.ts"))?.[1] ?? "";
const gateCode = new Set([...gateTypes.matchAll(/"([a-z-]+)"/g)].map((m) => m[1] ?? ""));

// --- the MCP tool count design.html states
const mcpSection = between(design, '<h3 id="mcp">', "</section>");
const statedCount = Number(/= (\d+)개/.exec(mcpSection)?.[1] ?? Number.NaN);

const CATEGORIES: Category[] = [
  { name: "event", where: "appendix event 이름 전체 ↔ core/contract/events", design: eventDesign, code: eventCode },
  { name: "event-glossary", where: "glossary §9 ↔ core/contract/events", design: glossaryEvents, code: eventCode },
  { name: "view", where: "appendix #schema 뷰 ↔ core/contract/views.ts Views", design: viewDesign, code: viewCode },
  { name: "tool", where: "claude-plugin/mcp/tools/README.md ↔ tools/*.ts", design: toolDesign, code: toolCode },
  { name: "cli", where: "glossary §11 ↔ cli/commands", design: cliDesign, code: cliCode },
  { name: "monitor", where: "glossary §1 ↔ MONITOR_NAMES + core/reaper", design: monitorDesign, code: monitorCode },
  { name: "gate", where: "appendix #gates ↔ core/gates GateName", design: gateDesign, code: gateCode },
];

/** `<category>:<name>:<side>` → the decision that records why design and code differ. */
const ALLOWED = new Map<string, string>([]);

type Diff = { key: string; category: string; name: string; side: "design-only" | "code-only"; where: string };

function diffs(): Diff[] {
  const out: Diff[] = [];
  for (const c of CATEGORIES) {
    for (const n of [...c.design].sort())
      if (!c.code.has(n)) out.push({ key: `${c.name}:${n}:design-only`, category: c.name, name: n, side: "design-only", where: c.where });
    for (const n of [...c.code].sort())
      if (!c.design.has(n)) out.push({ key: `${c.name}:${n}:code-only`, category: c.name, name: n, side: "code-only", where: c.where });
  }
  return out;
}

test("every category reads a non-empty name list from both sides", () => {
  for (const c of CATEGORIES) {
    assert.ok(c.design.size > 0, `${c.name}: no design names parsed from ${c.where}`);
    assert.ok(c.code.size > 0, `${c.name}: no code names parsed from ${c.where}`);
  }
});

test("design.html states the MCP tool count the code has", () => {
  assert.equal(statedCount, toolCode.size, `design.html #mcp says ${statedCount}, tools/ has ${toolCode.size}`);
});

test("every design/code name difference is a recorded decision", () => {
  const all = diffs();
  if (process.env.SPEC_NAMES_REPORT) {
    const lines = ["| category | name | side | where | decision |", "|---|---|---|---|---|"];
    for (const d of all) lines.push(`| ${d.category} | \`${d.name}\` | ${d.side} | ${d.where} | ${ALLOWED.get(d.key) ?? "—"} |`);
    const counts = CATEGORIES.map((c) => `${c.name}=${all.filter((d) => d.category === c.name).length}`).join(" ");
    console.log(`${lines.join("\n")}\n\ntotal=${all.length} allowed=${all.filter((d) => ALLOWED.has(d.key)).length} ${counts}`);
  }
  const unrecorded = all.filter((d) => !ALLOWED.has(d.key)).map((d) => d.key);
  assert.deepEqual(unrecorded, [], "names differ between design and code with no decision recorded");
});

test("the allow-list holds no entry that is no longer a difference", () => {
  const live = new Set(diffs().map((d) => d.key));
  assert.deepEqual([...ALLOWED.keys()].filter((k) => !live.has(k)), []);
});
