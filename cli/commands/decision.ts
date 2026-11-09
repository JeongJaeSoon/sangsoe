import { decisionAnswerFrom, decisionOpenFrom, defaultDeps } from "../../core/index.ts";

type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)]);

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

const refused = (reason: string) => ({ ok: false as const, refusal: { code: "bad_input", reason, fix: "see sangsoe decision --help" } });

// Shaped as U5's CommandDef (cli/contract.ts once it lands): `sangsoe decision add|answer`, the shell
// entrance to the same core functions as the decision_open and decision_answer MCP tools.
export default {
  name: "decision",
  summary: "open a decision (re-ask gate) or link an answer to one",
  usage:
    "add --subject <item:iNNN|scope:x> --question <text> [--option <o>]... [--waiter <task>@<run>]... [--carrier-run <run>] | answer --decision <dNNN> --answer <text> --owner-action <seq> [--linked-by <how>] [--run <run>]",
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
    run: { type: "string" },
  },
  maxPositionals: 1,
  async run({ values, positionals }: { values: Values; positionals: string[] }) {
    const [sub] = positionals;
    if (sub !== "add" && sub !== "answer") return refused("expected add or answer");
    const w = waiters(values.waiter);
    if (typeof w === "string") return refused(`--waiter ${w}: expected <task>@<run>`);
    const deps = defaultDeps();
    try {
      if (sub === "add") {
        return await decisionOpenFrom(
          {
            subject: values.subject,
            question: values.question,
            options: list(values.option),
            waiters: w,
            carrier_run: values["carrier-run"],
          },
          deps,
        );
      }
      return await decisionAnswerFrom(
        {
          decision: values.decision,
          answer: values.answer,
          owner_action: values["owner-action"],
          linked_by: values["linked-by"],
          run: values.run,
        },
        deps,
      );
    } finally {
      deps.store.close();
    }
  },
};
