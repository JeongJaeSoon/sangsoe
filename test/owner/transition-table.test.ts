import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countsAsEvidence,
  decisionAnswer,
  decisionOpen,
  linkChat,
  linkShell,
  ownerDone,
  ownerMarks,
  ownerTodoFrom,
  probeRound,
  recordProposal,
  recordShellLink,
  type ShellLine,
  type VerifySpec,
} from "../../core/index.ts";
import { createWorld } from "../decision/world.ts";
import { later, type OwnerWorld, ownerSays, ownerWorld, RUN, T0 } from "./world.ts";

// Decision 91⑥(3) as a table: input kind × current state → next state and mark, with the event that
// grounds it. Only rows 1, 2, 8, 9 and 10 change anything recorded, each by an observed effect or an
// explicit link; rows 1, 2 and 9 move the item or its owner_todo row, rows 8 and 10 only its mark.

const T = "task_000000000001";
const HINT = "gh workflow run promote-to-production.yml";
const RUN_OK: VerifySpec = { kind: "run_ok", repo: "acme/api" };
const RUN_URL = "https://github.com/acme/api/actions/runs/111";

const line = (w: OwnerWorld, o: Partial<ShellLine> = {}): ShellLine => ({
  uuid: `u-${w.store.events().length}`,
  command: `${HINT} -R acme/api -f ref=main`,
  exitCode: 0,
  stdout: `Created workflow_dispatch event\n${RUN_URL}\n`,
  stderr: "",
  repo: "acme/api",
  ts: w.now,
  ...o,
});

function look(w: OwnerWorld) {
  const input = w.input();
  const m = ownerMarks(input, { waitMinutes: 30 }).get(T);
  return { state: w.state(T), todo: ownerTodoFrom(input, w.facts()).length, mark: m?.mark ?? null, run: m?.run ?? null };
}

function shell(w: OwnerWorld, o: Partial<ShellLine> = {}) {
  const l = line(w, o);
  return recordShellLink(w.store, l, linkShell(w.input(), w.facts(), l));
}

const ports = (w: OwnerWorld) => ({ orca: w.orca, gh: w.ghClient });

interface Row {
  readonly n: number;
  readonly input: string;
  readonly ground: string;
  readonly changes: "state" | "mark_fields" | "none";
  readonly given: (w: OwnerWorld) => void | Promise<void>;
  readonly act: (w: OwnerWorld) => void | Promise<void>;
  readonly check: (before: ReturnType<typeof look>, after: ReturnType<typeof look>, w: OwnerWorld) => void;
}

const marked = (w: OwnerWorld) => {
  w.item(T, { verify: RUN_OK, cmdHint: HINT });
  shell(w);
};

const ROWS: readonly Row[] = [
  {
    n: 2,
    input: "panel 완료 button",
    ground: "explicit link (나): owner_action{button} + item_transition ready→done; reads ⏳ until a probe (decision 181)",
    changes: "state",
    given: (w) => void w.item(T, { verify: RUN_OK, cmdHint: HINT }),
    act: async (w) => {
      const r = await ownerDone({ orca: w.orca, store: w.store }, w.input(), w.facts(), { task: T });
      assert.ok(r.ok && r.value.pendingVerify, "verify with no probe yet: ⏳ 검증 대기");
    },
    check: (b, a, w) => {
      assert.equal(b.state, "ready");
      assert.equal(a.state, "pending_verify", "a to-do closes on verification, not on the press");
      assert.equal(a.todo, b.todo - 1);
      assert.equal(w.store.events().filter(countsAsEvidence).length, 0, "the button is not evidence when a verify exists");
    },
  },
  {
    n: 3,
    input: "chat `i001 했다` (no dNNN)",
    ground: "owner_act:proposed only",
    changes: "none",
    given: (w) => void w.item(T, { verify: RUN_OK, cmdHint: HINT }),
    act: (w) => {
      const seq = ownerSays(w, "i001 했다");
      const l = linkChat("i001 했다");
      assert.equal(l.kind, "proposed");
      recordProposal(w.store, T, seq);
    },
    check: (b, a) => assert.deepEqual(a, b),
  },
  {
    n: 4,
    input: "chat `했다` (no number)",
    ground: "owner_act:proposed only, no mark",
    changes: "none",
    given: (w) => void w.item(T, { verify: RUN_OK, cmdHint: HINT }),
    act: (w) => {
      ownerSays(w, "했다");
      assert.equal(linkChat("했다").kind, "none");
    },
    check: (b, a) => assert.deepEqual(a, b),
  },
  {
    n: 5,
    input: "`!` line matching cmd_hint, exit 0, no stderr",
    ground: "owner_act:seen → mark 입력 확인됨 · 검증 중",
    changes: "none",
    given: (w) => void w.item(T, { verify: RUN_OK, cmdHint: HINT }),
    act: (w) => void shell(w),
    check: (b, a) => {
      assert.deepEqual({ ...a, mark: b.mark, run: b.run }, b, "state and owner_todo unchanged");
      assert.equal(a.mark, "verifying");
    },
  },
  {
    n: 6,
    input: "the same line on an item with no verify",
    ground: "owner_act:seen → 검증 안 됨, the panel button must answer",
    changes: "none",
    given: (w) => void w.item(T, { cmdHint: HINT }),
    act: (w) => void shell(w),
    check: (b, a) => {
      assert.equal(a.state, b.state);
      assert.equal(a.todo, b.todo);
      assert.equal(a.mark, "no_verify");
    },
  },
  {
    n: 7,
    input: "the same line, exit≠0 or stderr",
    ground: "owner_act:failed, no mark",
    changes: "none",
    given: (w) => void w.item(T, { verify: RUN_OK, cmdHint: HINT }),
    act: (w) => void shell(w, { exitCode: 1, stderr: "HTTP 422: workflow not found", stdout: "" }),
    check: (b, a) => {
      assert.equal(a.state, b.state);
      assert.equal(a.todo, b.todo);
      assert.equal(a.mark, "failed");
    },
  },
  {
    n: 8,
    input: "the same line again on a marked item",
    ground: "another owner_act:seen: mark stays, run is the new one",
    changes: "mark_fields",
    given: marked,
    act: (w) => void shell(w, { stdout: "https://github.com/acme/api/actions/runs/222" }),
    check: (b, a) => {
      assert.equal(a.state, b.state);
      assert.equal(a.todo, b.todo);
      assert.equal(b.run, "111");
      assert.equal(a.run, "222");
      assert.equal(a.mark, "verifying");
    },
  },
  {
    n: 9,
    input: "probe true",
    ground: "observed effect (가): evidence probe:run_ok + close_suggested{verified}",
    changes: "state",
    given: (w) => {
      marked(w);
      w.gh.set("repos/acme/api/actions/runs/111", { status: "completed", conclusion: "success" });
    },
    act: async (w) => {
      const r = await probeRound(ports(w), w.store, w.input(), w.facts());
      assert.deepEqual(r.passed, [T]);
    },
    check: (b, a, w) => {
      assert.equal(a.state, "ready", "the probe does not close; the holder does");
      assert.equal(a.todo, b.todo - 1, "out of owner_todo");
      assert.equal(w.store.events().filter((e) => e.type === "close_suggested" && e.payload.reason === "verified").length, 1);
    },
  },
  {
    n: 10,
    input: "owner `아직` (orchestrator's owner_class)",
    ground: "owner_class{not_yet} on the item: mark and run cleared",
    changes: "mark_fields",
    given: marked,
    act: (w) => {
      const seq = ownerSays(w, "아직이야");
      w.store.append({ type: "owner_class", source: "mcp:orchestrator", payload: { class: "not_yet" }, subject: String(seq), entity: "task", entity_id: T });
    },
    check: (b, a) => {
      assert.equal(a.state, b.state);
      assert.equal(a.todo, b.todo);
      assert.equal(b.mark, "verifying");
      assert.equal(a.mark, null);
      assert.equal(a.run, null);
    },
  },
  {
    n: 11,
    input: "probe not true within verify.wait_minutes",
    ground: "mark → 검증 안 됨 + escalation_stale{verify_unconfirmed}",
    changes: "none",
    given: (w) => {
      marked(w);
      w.gh.set("repos/acme/api/actions/runs/111", { status: "completed", conclusion: "failure" });
    },
    act: async (w) => {
      w.at(later(T0, 31));
      const r = await probeRound(ports(w), w.store, w.input(), w.facts());
      assert.deepEqual(r.escalated, [T]);
    },
    check: (b, a) => {
      assert.equal(a.state, b.state);
      assert.equal(a.todo, b.todo);
      assert.equal(a.mark, "unverified");
    },
  },
];

for (const r of ROWS) {
  test(`row ${r.n}: ${r.input} → ${r.changes === "state" ? "changes state" : r.changes === "mark_fields" ? "changes the mark only" : "no state change"} (${r.ground})`, async () => {
    const w = ownerWorld();
    await r.given(w);
    const before = look(w);
    await r.act(w);
    r.check(before, look(w), w);
  });
}

test("row 1: a chat answer with dNNN closes the decision (explicit link, U8's decision_answer)", async () => {
  const D = "task_000000000002";
  const world = createWorld([{ id: D, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const opened = await decisionOpen(world, { subject: "item:i001", options: ["a", "b"], question: "which?", waiters: [{ task: D, run: RUN }], callerRun: RUN });
  assert.ok(opened.ok);
  const d = opened.value.decision;
  const input = () => ({
    orca: { tasks: [], gates: [...world.gates.values()].map((g) => ({ id: g.id, taskId: g.taskId, open: g.status === "pending" })) },
    events: world.store.events(),
    now: T0,
  });
  assert.equal(ownerTodoFrom(input(), []).length, 1);
  const text = `${d} a 로 가자`;
  assert.deepEqual(linkChat(text), { kind: "decision", decisions: [d] });
  const seq = world.store.appendOwnerAction({ type: "owner_action", source: "UserPromptSubmit", payload: { origin: "chat", summary: text, hash: "h" } }, text).seq;
  const r = await decisionAnswer(world, { decision: d, answer: text, ownerAction: seq, linkedBy: "hook", callerRun: RUN });
  assert.ok(r.ok);
  assert.equal(ownerTodoFrom(input(), []).length, 0);
});

test("the table covers rows 1–11 and only 1, 2, 8, 9, 10 change anything recorded", () => {
  const changing = [1, ...ROWS.filter((r) => r.changes !== "none").map((r) => r.n)].sort((a, b) => a - b);
  assert.deepEqual(changing, [1, 2, 8, 9, 10]);
  assert.deepEqual([1, ...ROWS.map((r) => r.n)], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});
