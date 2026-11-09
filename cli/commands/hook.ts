import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  evaluate,
  hookOutput,
  hostFacts,
  parseHookInput,
  recordDenial,
  replay,
  Store,
} from "../../core/index.ts";
import type { CommandDef, Report } from "../contract.ts";

// The blocking PreToolUse hook's one process per event (R-09): read Claude Code's input on stdin, run
// every gate, print deny or ask (never allow), record each deny. A failure exits non-zero, and the
// hook's onFailure "block" turns that into a refusal: the hook fails closed.

const EVENTS = ["pre-tool-use"];

export default {
  name: "hook",
  summary: "Claude Code hook entry: gates and shape checks for one PreToolUse call (stdin), or --replay a fixture",
  usage: "pre-tool-use [--replay <jsonl>]",
  maxPositionals: 1,
  options: { replay: { type: "string" } },
  run({ values, positionals, host }): Report {
    const [event] = positionals;
    if (!event || !EVENTS.includes(event)) {
      return { code: 2, lines: [`unknown hook event "${event ?? ""}"; one of: ${EVENTS.join(", ")}`] };
    }
    if (typeof values.replay === "string") {
      const { rows, counts } = replay(readFileSync(values.replay, "utf8"));
      const lines = rows.map((r) => `${r.ok ? "ok  " : "FAIL"} ${String(r.n).padStart(3)} ${r.expect}->${r.got} ${r.gates.join(",") || "-"}  ${r.note}`);
      lines.push(JSON.stringify(counts));
      return { code: counts.falsePositive + counts.falseNegative + counts.wrongGate === 0 ? 0 : 1, lines };
    }

    const parsed = parseHookInput(readFileSync(0, "utf8"));
    if (!parsed.ok) return { code: 2, lines: [`sangsoe hook: ${parsed.reason}`] };
    const home = host.env.HOME ?? homedir();
    let store: Store | undefined;
    const openStore = () => {
      store ??= Store.open({ home });
      return store;
    };
    try {
      const m = evaluate(parsed.call, hostFacts(parsed.input, host, openStore));
      if (m.decision === "deny") {
        try {
          recordDenial(m, parsed.input, home, openStore());
        } catch (e) {
          // The deny stands even when it cannot be recorded.
          m.verdicts.push({ decision: "deny", gate: m.verdicts[0]?.gate ?? "start", reason: `(not recorded: ${(e as Error).message})` });
        }
      }
      const out = hookOutput(m);
      return { code: 0, lines: out === "" ? [] : [out] };
    } finally {
      store?.close();
    }
  },
} satisfies CommandDef;
