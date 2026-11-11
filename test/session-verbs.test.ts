// Decision 193 dropped the adapter rows for Orca verbs that sessions run themselves. Each such verb
// is then reachable only if the session text names it: the role agents and sangsoe's own skills,
// not the general skills (they are ported and say nothing about sangsoe's roles).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, "utf8");
const walkMd = (dir: string): string[] =>
  readdirSync(`${ROOT}${dir}`, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === "evals" || e.name === "general"
        ? []
        : walkMd(`${dir}/${e.name}`)
      : e.name.endsWith(".md") && e.name !== "README.md"
        ? [`${dir}/${e.name}`]
        : [],
  );

// Design rows: design.html §2 placement table, "카드 표시 · 조회", "Orca 참조", "Orca 검색".
const SESSION_VERBS = ["worktree set", "reference list", "search"];

const recorded = new Set(
  (JSON.parse(read("test/fake-orca/scenarios/local/agent-context.json")) as { commands: { command: string }[] }).commands.map(
    (c) => c.command,
  ),
);
const sessionText = [...walkMd("claude-plugin/agents"), ...walkMd("claude-plugin/skills")].map((f) => [f, read(f)] as const);

test("each verb decision 193 hands to sessions is a recorded Orca command", () => {
  for (const verb of SESSION_VERBS) assert.ok(recorded.has(verb), `${verb} is not in the recorded agent-context`);
});

test("the session text names each of those verbs as a full orca command", () => {
  assert.ok(sessionText.length > 10, "the reader found no session text");
  const missing = SESSION_VERBS.filter((verb) => !sessionText.some(([, text]) => text.includes(`orca ${verb} `)));
  assert.deepEqual(missing, []);
});
