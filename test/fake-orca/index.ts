import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CommandSpec, type Exec, type ExecResult, ORCA_COMMANDS } from "../../core/index.ts";

const SCENARIOS = new URL("./scenarios/", import.meta.url).pathname;

/** A reply for one command: a JSON document (printed as stdout) or a function of argv. */
export type FakeReply = unknown | ((args: readonly string[]) => ExecResult);

export type FakeOrca = {
  exec: Exec;
  /** Every call as `[file, ...args]`, in order. */
  calls: string[][];
};

/** Writes Orca keeps no request receipt for, so ORCA_COMMANDS does not mark them `write`. */
const UNTRACKED_WRITES = new Set(["worktree-rm", "reference-add", "worktree-create", "terminal-close"]);

/** `orchestration send --help`: "Valid --type values". Real Orca refuses any other. */
export const SEND_TYPES: ReadonlySet<string> = new Set(["status", "dispatch", "worker_done", "merge_ready", "escalation", "handoff", "decision_gate", "question", "heartbeat"]);

/** The adapter row whose path starts argv; the longest path wins. */
function specFor(args: readonly string[]): [string, CommandSpec] | undefined {
  let best: [string, CommandSpec] | undefined;
  for (const spec of Object.values(ORCA_COMMANDS) as CommandSpec[]) {
    const fits = spec.path.every((word, i) => args[i] === word);
    if (fits && (!best || spec.path.length > best[1].path.length)) best = [spec.path.join("-"), spec];
  }
  return best;
}

function reply(doc: FakeReply, args: readonly string[]): ExecResult {
  if (typeof doc === "function") return (doc as (a: readonly string[]) => ExecResult)(args);
  const failed = typeof doc === "object" && doc !== null && (doc as { ok?: unknown }).ok === false;
  return { code: failed ? 1 : 0, stdout: JSON.stringify(doc), stderr: "" };
}

function recorded(scenario: string, key: string): unknown {
  for (const dir of [scenario, "local"]) {
    const file = join(SCENARIOS, dir, `${key}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  }
  return undefined;
}

/**
 * Orca without Orca: answers `orca … --json` from recorded JSON in scenarios/<name>/, falling back
 * to scenarios/local/. It refuses any command outside ORCA_COMMANDS, so a test that reaches a
 * consuming mail read or an unlisted start fails loudly. Writes with no recording answer
 * `{ ok: true, result: {} }`; recordings are reads only (no Orca writes while recording).
 * `claude plugin list --json` is answered from `claude-plugin-list.json`.
 */
export function createFakeOrca(o: { scenario?: string; replies?: Record<string, FakeReply> } = {}): FakeOrca {
  const scenario = o.scenario ?? "local";
  if (!existsSync(join(SCENARIOS, scenario))) throw new Error(`fake orca: no scenario ${scenario}`);
  const calls: string[][] = [];
  const exec: Exec = async (file, args) => {
    calls.push([file, ...args]);
    if (file === "claude") {
      const key = "claude-plugin-list";
      if (args.join(" ") !== "plugin list --json") throw new Error(`fake orca: claude ${args.join(" ")} is not faked`);
      return reply(o.replies?.[key] ?? recorded(scenario, key), args);
    }
    if (file !== "orca") throw new Error(`fake orca: ${file} is not faked`);
    const found = specFor(args);
    if (!found) throw new Error(`fake orca: orca ${args.join(" ")} is not in ORCA_COMMANDS`);
    const [key, spec] = found;
    const type = args[args.indexOf("--type") + 1];
    if (key === "orchestration-send" && args.includes("--type") && !SEND_TYPES.has(type ?? "")) {
      return reply({ ok: false, error: { code: "invalid_argument", message: `--type ${type} is not a message type` } }, args);
    }
    const known: readonly string[] = [...spec.flags, ...("optional" in spec ? spec.optional : [])];
    const unlisted = args.filter((a) => a.startsWith("--") && !known.includes(a.slice(2)));
    if (unlisted.length > 0) throw new Error(`fake orca: ${unlisted.join(" ")} is not in ORCA_COMMANDS for ${key}`);
    const doc = o.replies?.[key] ?? recorded(scenario, key);
    if (doc !== undefined) return reply(doc, args);
    if ("write" in spec || UNTRACKED_WRITES.has(key)) return reply({ ok: true, result: {} }, args);
    return reply({ ok: false, error: { code: "fake_not_recorded", message: `no recording for ${key}` } }, args);
  };
  return { exec, calls };
}
