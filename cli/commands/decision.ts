import { decisionAnswerFrom, decisionMootFrom, decisionOpenFrom, defaultDeps } from "../../core/index.ts";
import type { CommandDef, Outcome } from "../contract.ts";

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)]);

const refused = (reason: string): Outcome => ({
  ok: false,
  refusal: { code: "bad_input", reason, fix: "sangsoe decision --help" },
});

// `--waiter <task>@<run>`, repeatable: the shell form of decision_open's waiters.
function waiters(v: unknown): { task: string; run: string }[] | string {
  const out: { task: string; run: string }[] = [];
  for (const w of list(v)) {
    const [task, run, extra] = w.split("@");
    if (!task || !run || extra !== undefined) return w;
    out.push({ task, run });
  }
  return out;
}

// The shell entrance (hooks, the owner's terminal) to the same functions as the decision_open and
// decision_answer MCP tools. `moot` has no MCP tool (decision 91③): queue-monitor calls it, and a Run
// handed a moot gate resumes it here. Every subcommand acts in the Run this terminal holds.
export default {
  name: "decision",
  summary: "open a decision (re-ask gate), link an answer to one, or moot one",
  usage:
    "add --subject <item:iNNN|item:task_x|scope:x> --question <text> [--option <o>]... [--waiter <task>@<run>]... [--carrier-run <run>]\n" +
    "       | answer --decision <dNNN> --answer <text> --owner-action <seq> [--linked-by <how>]\n" +
    "       | moot --decision <dNNN>",
  options: {
    subject: { type: "string" },
    question: { type: "string" },
    option: { type: "string", multiple: true },
    waiter: { type: "string", multiple: true },
    "carrier-run": { type: "string" },
    decision: { type: "string" },
    answer: { type: "string" },
    "owner-action": { type: "string" },
    "linked-by": { type: "string" },
  },
  maxPositionals: 1,
  async run({ values, positionals }) {
    const [sub] = positionals;
    if (sub === "add") {
      const w = waiters(values.waiter);
      if (typeof w === "string") return refused(`--waiter ${w}: expected <task>@<run>`);
      return decisionOpenFrom(
        {
          subject: values.subject,
          question: values.question,
          options: list(values.option),
          waiters: w,
          carrier_run: values["carrier-run"],
        },
        defaultDeps,
      );
    }
    if (sub === "answer") {
      return decisionAnswerFrom(
        {
          decision: values.decision,
          answer: values.answer,
          owner_action: values["owner-action"],
          linked_by: values["linked-by"],
        },
        defaultDeps,
      );
    }
    if (sub === "moot") return decisionMootFrom({ decision: values.decision }, defaultDeps);
    return refused("expected add, answer or moot");
  },
} satisfies CommandDef;
