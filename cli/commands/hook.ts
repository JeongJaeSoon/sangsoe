import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createOrcaAdapter,
  evaluate,
  type Host,
  hookOutput,
  hostFacts,
  nodeExec,
  parseHookInput,
  parseSessionInput,
  recordDenial,
  recordHook,
  replay,
  SESSION_HOOKS,
  type SessionHook,
  Store,
} from "../../core/index.ts";
import type { CommandDef, Report } from "../contract.ts";

// One process per hook event (R-09). The blocking PreToolUse hook reads Claude Code's input on stdin, runs
// every gate, prints deny or ask (never allow) and records each deny; a failure exits non-zero, and the
// hook's onFailure "block" turns that into a refusal: it fails closed. The recording hooks fail open.

const EVENTS = ["pre-tool-use", ...SESSION_HOOKS];

export default {
  name: "hook",
  summary: "Claude Code hook entry: gates for one PreToolUse call, or one recording hook (stdin); --replay a gate fixture",
  usage: `<${EVENTS.join("|")}> [--replay <jsonl>]`,
  maxPositionals: 1,
  options: { replay: { type: "string" } },
  run({ values, positionals, host }): Report | Promise<Report> {
    const [event] = positionals;
    if (!event || !EVENTS.includes(event)) {
      return { code: 2, lines: [`unknown hook event "${event ?? ""}"; one of: ${EVENTS.join(", ")}`] };
    }
    if ((SESSION_HOOKS as readonly string[]).includes(event)) return record(event as SessionHook, host);
    if (typeof values.replay === "string") {
      const { rows, counts } = replay(readFileSync(values.replay, "utf8"));
      const lines = rows.map((r) => `${r.ok ? "ok  " : "FAIL"} ${String(r.n).padStart(3)} ${r.expect}->${r.got} ${r.gates.join(",") || "-"}  ${r.note}`);
      lines.push(JSON.stringify(counts));
      return { code: counts.falsePositive + counts.falseNegative + counts.wrongGate === 0 ? 0 : 1, lines };
    }

    return gate(host);
  },
} satisfies CommandDef;

// A recording hook never blocks: whatever fails, it exits 0. Only SessionStart prints (its stdout is the
// injected context); a failure there prints nothing rather than a half injection.
async function record(event: SessionHook, host: Host): Promise<Report> {
  let input: ReturnType<typeof parseSessionInput>;
  try {
    input = parseSessionInput(readFileSync(0, "utf8"));
  } catch {
    input = undefined;
  }
  if (!input) return { code: 0, lines: [] };
  let store: Store | undefined;
  try {
    store = Store.open({ home: host.env.HOME ?? homedir() });
    const lines = await recordHook(event, { store, orca: createOrcaAdapter(nodeExec(HOOK_ORCA_MS)) }, input, {
      pluginVersion: pluginVersion(host),
    });
    return { code: 0, lines };
  } catch (e) {
    process.stderr.write(`sangsoe hook ${event}: ${(e as Error).message}\n`);
    return { code: 0, lines: [] };
  } finally {
    store?.close();
  }
}

const HOOK_ORCA_MS = 5_000;

function pluginVersion(host: Host): string | undefined {
  const root = host.env.CLAUDE_PLUGIN_ROOT;
  if (!root) return undefined;
  try {
    const v = (JSON.parse(host.readText(join(root, ".claude-plugin", "plugin.json"))) as { version?: unknown }).version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

function gate(host: Host): Report {
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
}
