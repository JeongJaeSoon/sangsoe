import { receiptId } from "../notify/receipt.ts";
import { type CoreDeps, done, type Result, refuse } from "../notify/result.ts";
import { locate } from "./locate.ts";

/** The four judgment states the store does not hold (design N1). */
export const HANDOFF_FIELDS = ["next", "waiting", "open_questions", "reply_to"] as const;
export type Handoff = Record<(typeof HANDOFF_FIELDS)[number], string>;

const MAX = 4000;
const LABEL: Handoff = {
  next: "다음에 할 일",
  waiting: "기다리는 답",
  open_questions: "답 없는 질문",
  reply_to: "오너 요청의 회신 경로",
};

export function parseHandoff(raw: Readonly<Record<string, unknown>>): Result<Handoff> {
  const out: Partial<Handoff> = {};
  for (const k of HANDOFF_FIELDS) {
    const v = raw[k];
    if (typeof v !== "string" || v.trim() === "") return refuse("bad_input", `${k}: expected non-empty text`, `pass ${k}; write "없음" when there is none`);
    if (v.length > MAX) return refuse("bad_input", `${k}: ${v.length} characters, over ${MAX}`, `shorten ${k}; the store and Orca keep the rest`);
    out[k] = v.trim();
  }
  const extra = Object.keys(raw).filter((k) => !(HANDOFF_FIELDS as readonly string[]).includes(k));
  if (extra.length > 0) return refuse("bad_input", `unknown field(s) ${extra.join(", ")}`, `pass only ${HANDOFF_FIELDS.join(", ")}`);
  return done(out as Handoff);
}

export const renderHandoff = (h: Handoff): string => HANDOFF_FIELDS.map((k) => `## ${LABEL[k]}\n${h[k]}`).join("\n\n");

/** The subject a Dispatch-holding session's handoff carries, so its next session finds its own among the Run's mail. */
export const handoffSubject = (task: string) => `handoff ${task}`;

/**
 * handoff_save: checks the four fields and sends them as one Orca `handoff` message, where the next
 * session's SessionStart reads the last one. A session without a Dispatch (the orchestrator) sends to
 * the Run it holds. One with a Dispatch cannot: Orca sends its mail only to the Dispatch's own Run
 * (dispatch_run_mismatch), so it goes there under its Task's subject (decision 197). Nothing goes to
 * sqlite: the handoff body is Orca's (decision 80 N1).
 */
export async function handoffSave(
  deps: Pick<CoreDeps, "orca">,
  raw: Readonly<Record<string, unknown>>,
  cwd: string = process.cwd(),
): Promise<Result<{ msgId: string | null; run: string }>> {
  const parsed = parseHandoff(raw);
  if (!parsed.ok) return parsed;
  const loc = await locate(deps.orca, cwd);
  if (loc) {
    const sent = await deps.orca.send({
      to: `run:${loc.run}`,
      type: "handoff",
      subject: handoffSubject(loc.task),
      body: renderHandoff(parsed.value),
      taskId: loc.task,
      dispatchId: loc.dispatch,
    });
    if (!sent.ok) return refuse("orca_error", `send: ${sent.error.code}`, "call handoff_save again");
    return done({ msgId: receiptId(sent.value, "message") ?? null, run: loc.run });
  }
  const current = await deps.orca.runCurrent();
  if (!current.ok) return refuse("orca_error", `run-current: ${current.error.code}`, "retry once Orca answers");
  const run = current.value.runId;
  if (typeof run !== "string" || run === "") return refuse("no_run", "this session holds no Run", "run-use your Run first; a worker reports through worker_done instead");
  const sent = await deps.orca.send({ to: `run:${run}`, type: "handoff", subject: "handoff", body: renderHandoff(parsed.value) });
  if (!sent.ok) return refuse("orca_error", `send: ${sent.error.code}`, "call handoff_save again");
  return done({ msgId: receiptId(sent.value, "message") ?? null, run });
}
