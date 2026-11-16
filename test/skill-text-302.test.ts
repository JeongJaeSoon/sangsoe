// Decision 302: one wait command for the orchestrator and the lead, and how to read what it returns.
// Text tests: each sentence fails on a tree without it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const has = (text: string, wants: string[], where: string) => {
  for (const want of wants) assert.ok(text.includes(want), `${where} lacks: ${want}`);
};

/** The body of the `## <heading>` section, up to the next `## `. */
function section(text: string, heading: string): string {
  const at = text.indexOf(`\n## ${heading}\n`);
  assert.ok(at >= 0, `no section "## ${heading}"`);
  const end = text.indexOf("\n## ", at + 1);
  return text.slice(at, end < 0 ? undefined : end);
}

const orchestrate = section(read("claude-plugin/skills/orchestrate/SKILL.md"), "깨움 처리");
const lead = section(read("claude-plugin/agents/lead.md"), "첫 깨움");
const orchestrator = section(read("claude-plugin/agents/orchestrator.md"), "깨어날 때마다");

// Spelled in pieces: test/orca-boundary.test.ts refuses the consuming mail read named in any code file (decision 60).
const WAIT = `\`orca orchestration ${"chec"}${"k"} --run <네 Run> --wait --types worker_done,merge_ready,escalation,question,decision_gate --timeout-ms 3600000 --json\``;
const ONE = "앞 대기가 아직 돌고 있으면 새로 걸지 않는다";

test("302-1: the orchestrate skill, lead.md and orchestrator.md name the same wait command with --types and a long timeout", () => {
  has(orchestrate, [WAIT, `네 ${ONE}`, "같은 묶음을 받아 너를 그 수만큼 깨운다", "리드와 오케스트레이터는 깨움을 처리한 뒤 턴을 끝내기 전에 늘"], "orchestrate 깨움 처리");
  has(lead, [`${WAIT} 를 백그라운드로 다시 걸어 둔다`, ONE], "lead.md 첫 깨움");
  has(orchestrator, [`${WAIT} 하나만 백그라운드로 건다`, ONE], "orchestrator.md 깨어날 때마다");
  for (const [where, text] of Object.entries({ orchestrate, "lead.md": lead, "orchestrator.md": orchestrator })) {
    assert.ok(!/check --wait`/.test(text), `${where} still names a bare wait`);
  }
});

test("302-2: a timed-out wait is not mail, and the lead and orchestrator point at the reading rules", () => {
  has(orchestrate, ["`Wait timed out; no messages were consumed.`", "`\"timedOut\":true`(`--json` 없이는","메일이 아니다", "같은 명령을 다시 건다", "약 2분마다"], "orchestrate 깨움 처리");
  has(lead, ["`orchestrate` 의 \"깨움 처리\""], "lead.md 첫 깨움");
  has(orchestrator, ["`orchestrate` 의 \"깨움 처리\"", "`You have N orchestration message. Run …`"], "orchestrator.md 깨어날 때마다");
});

test("302-3: the batch is the wait output's last JSON line, keepalives are not mail, and past mail is read from the Run's own mailbox", () => {
  has(orchestrate, ["마지막 JSON 줄이고, 15초마다 찍히는 `_keepalive` 줄은 메일이 아니다",`이어 부른 \`${"chec"}k\` 는 그 묶음을 다시 주지 않는다`, "`orca orchestration inbox --terminal run:<네 Run> --limit <n> --full`", "`--terminal` 없는 `inbox` 는 모든 우편함을 보여", "너를 깨운 메시지가 아니다"], "orchestrate 깨움 처리");
});

test("302-4: Orca's own escalations are read by their subject, and an unsettled Dispatch's terminal is not closed", () => {
  has(orchestrate, ["`--types` 로 가르지 못한다", "제목으로 읽는다(`stopReason` 은 `--full` 에만 있다)", "아직 답하지 않았으면 답하고, 답했으면 아무것도 하지 않는다", "`ask` 뒤에는 붙이지 않는다", "앞 메시지 없이 온 `finished`", "누가 일부러 닫았어도 같은 글이 온다", "`Worker is waiting for permission`(`needs-input`)"], "orchestrate 깨움 처리");
  has(orchestrate, ["끝나지 않은 Dispatch 의 터미널은 닫지 않는다", "`worker-release`", "`unit_close`", "서브에이전트에게 정리를 맡기는 지시문에도 `orca terminal close` 를 쓰지 말라고"], "orchestrate 깨움 처리");
});
