import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "./index.ts";
import type { Facts } from "./types.ts";

// Decision 301: the orchestrator answering a lead that holds no Dispatch (handles and ids are synthetic).
const orchestrator: Facts = {
  role: () => "orchestrator",
  load: () => ({ level: "ok", reasons: [] }),
  ownOpenPrs: () => undefined,
  readScript: () => undefined,
  doneBlockers: () => [],
  sangsoe: () => undefined,
};
const bash = (command: string) => evaluate({ tool: "Bash", input: { command }, cwd: "/work/acme", subagent: false }, orchestrator);
const why = (m: ReturnType<typeof bash>) => m.verdicts.map((v) => v.reason).join("\n");
const TERM = "term_00000000-0000-4000-8000-0000000000aa";

test("301: a send to a term_ handle is refused and the refusal names the addresses of a session with no Dispatch", () => {
  const m = bash(`orca orchestration send --to ${TERM} --type status --subject "Re: park" --body "ok"`);
  assert.equal(m.decision, "deny");
  const reason = m.verdicts.find((v) => v.gate === "report-address")?.reason ?? "";
  assert.match(reason, /orca orchestration reply --id <message_id>/);
  assert.match(reason, /run-list --json --full/);
  assert.match(reason, /coordinator_handle/);
  assert.match(reason, /sender that holds no Dispatch itself \(the orchestrator\)[^.]*Run it coordinates/);
  assert.match(reason, /--to run:<that id>/);
  assert.match(reason, /holds no Run and sent no message has no address; tell the owner/);
});

test("301: a brief that reports to a term_ handle is refused without the no-Dispatch addresses", () => {
  const spec = `Report with orca orchestration send --to ${TERM} --type status`;
  const m = evaluate({ tool: "mcp__plugin_sangsoe_sangsoe__start_unit", input: { spec }, cwd: "/work/acme", subagent: false }, orchestrator);
  const reason = m.verdicts.find((v) => v.gate === "report-address")?.reason ?? "";
  assert.match(reason, /The brief reports to a term_ handle/);
  assert.doesNotMatch(reason, /no Dispatch/);
});

test("301: each way the refusal names passes every gate for the orchestrator", () => {
  for (const command of [
    `orca orchestration run-list --json --full | jq -r '.result.runs[] | select(.coordinator_handle == "${TERM}") | .id'`,
    `orca orchestration reply --id msg_000000000001 --body "ok, park it"`,
    `orca orchestration send --to run:run_000000000001 --type question --subject "Re: park" --body "ok"`,
  ]) {
    const m = bash(command);
    assert.equal(m.decision, "none", `${command}\n${why(m)}`);
  }
});

test("301: closing a terminal with no Dispatch stays refused and the refusal says the owner closes it", () => {
  const m = bash(`orca terminal close --terminal ${TERM}`);
  assert.equal(m.decision, "deny");
  assert.match(why(m), /no Dispatch[^.]*is closed by the owner in Orca: tell them its handle/);
});
