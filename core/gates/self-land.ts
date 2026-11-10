import { againstCwd, option, parse, unwrap } from "./shell.ts";
import type { Facts, Gate, Verdict } from "./types.ts";

// Appendix #gates [gate:self-land] and decision 81: merging is `sangsoe land` alone, and a worker does not
// finish over its own open PR without a land request. A person's own session (role general) is left alone.
// Decision 201: open PRs that cannot be read are refused too, so the gate never passes on a guess.

const WAIT_LINE = /(?:^|[\s"'])READY-WAIT:[ \t]*[\w-]+/m;
const LAND = "the MCP tool land (mcp__plugin_sangsoe_sangsoe__land), or `sangsoe land --pr <N>` from a person's terminal";

function verdict(reason: string): Verdict {
  return { decision: "deny", gate: "self-land", reason: `[gate:self-land] ${reason}` };
}

const UNREAD =
  "이 worktree 의 열린 PR 을 읽지 못해(origin 을 GitHub 저장소로 풀지 못했거나 gh 가 답하지 않음) land 없이 끝내는지 확인할 수 없다. land 를 부르거나 본문에 `READY-WAIT: <kind>` 줄을 적는다.";

/** The first open PR with no land request, or `null` when the open PRs could not be read. */
function openWithoutLand(facts: Facts): string | null | undefined {
  const prs = facts.ownOpenPrs();
  return prs === undefined ? null : prs.find((p) => !p.landRequested)?.pr;
}

/** The lines of the first heredoc that `<<WORD` opens on or after the line holding `--body`. */
function heredoc(text: string, word: string): string {
  const lines = text.split("\n");
  const from = Math.max(0, lines.findIndex((l) => l.includes("--body")));
  const opens = new RegExp(`<<-?\\s*['"]?${word.replace(/[.-]/g, "\\$&")}['"]?`);
  const at = lines.findIndex((l, i) => i >= from && opens.test(l));
  if (at === -1) return "";
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.replace(/^\t+/, "") === word) break;
    out.push(l);
  }
  return out.join("\n");
}

// The report body as sent: `--body` text (a `$(cat f)`, `$(<f)` or `$(cat <<EOF …)` body resolved) or
// `--body-file`. undefined when it cannot be read from the command (stdin).
function body(argv: readonly string[], text: string, cwd: string, facts: Facts): string | undefined {
  const read = (path: string) => facts.readScript(againstCwd(cwd, path)) ?? "";
  const file = option(argv, "--body-file");
  if (file === "-") return undefined;
  if (file !== undefined) return read(file);
  const value = (option(argv, "--body") ?? "").trim();
  const doc = /\$\(\s*cat\s*<<-?\s*(['"]?)([\w.-]+)\1/.exec(value);
  if (doc) return `${value}\n${heredoc(text, doc[2] ?? "")}`;
  const cat = /^\$\(\s*(?:cat\s+|<\s*)(['"]?)([^'"\s)]+)\1\s*\)$/.exec(value);
  return cat ? read(cat[2] ?? "") : value;
}

// `gh api -X PUT repos/o/r/pulls/N/merge` is the same merge as `gh pr merge`.
function apiMerge(argv: readonly string[]): boolean {
  if (!argv.some((a) => /(^|\/)pulls\/\d+\/merge(\?|$)/.test(a))) return false;
  const method = option(argv, "--method") ?? option(argv, "-X") ?? argv.find((a) => /^-X\w+$/.test(a))?.slice(2);
  return method?.toUpperCase() === "PUT";
}

export const selfLandGate: Gate = (call, facts) => {
  if (call.tool !== "Bash") return null;
  const text = String(call.input.command ?? "");
  for (const cmd of parse(text).commands) {
    const { argv } = unwrap(cmd.words);
    const pos = argv.filter((a) => !a.startsWith("-"));
    const merge = argv[0] === "gh" && ((pos[1] === "pr" && pos[2] === "merge") || (pos[1] === "api" && apiMerge(argv)));
    if (merge && facts.role() !== "general") {
      return verdict(`A direct merge skips the land checks. Merge through ${LAND}.`);
    }
    const send = argv[0] === "orca" && pos[1] === "orchestration" && pos[2] === "send";
    // Decision 175: merge_ready is the name of the report inside worker_done, not a message of its own.
    if (send && option(argv, "--type") === "merge_ready" && (facts.role() === "worker" || facts.role() === "lead")) {
      return verdict("A PR author ends with one worker_done that carries the merge-wait report. Send it as `--type worker_done`.");
    }
    const done =
      send &&
      option(argv, "--type") === "worker_done" &&
      option(argv, "--outcome") !== "failed";
    const sent = done ? body(argv, text, call.cwd, facts) : undefined;
    if (sent !== undefined && facts.role() === "worker" && !WAIT_LINE.test(sent)) {
      const pr = openWithoutLand(facts);
      if (pr === null) return verdict(UNREAD);
      if (pr) {
        return verdict(
          `${pr} is still open with no land request. Land it through ${LAND}, ` +
            "or name the wait with a `READY-WAIT: <kind>` line in the body.",
        );
      }
    }
  }
  return null;
};
