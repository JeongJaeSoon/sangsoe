import { isAbsolute, join } from "node:path";
import { option, parse, unwrap } from "./shell.ts";
import type { Facts, Gate, Verdict } from "./types.ts";

// Appendix #gates [gate:self-land] and decision 81: merging is `sangsoe land` alone, and a worker does not
// finish over its own open PR without a land request. A person's own session (role general) is left alone.
// What cannot be read (the open PRs) is not judged: the call passes.

const WAIT_LINE = /(?:^|[\s"'])READY-WAIT:[ \t]*[\w-]+/m;
const LAND = "the MCP tool land (mcp__plugin_sangsoe_sangsoe__land), or `sangsoe land <pr>` from a person's terminal";

function verdict(reason: string): Verdict {
  return { decision: "deny", gate: "self-land", reason: `[gate:self-land] ${reason}` };
}

function openWithoutLand(facts: Facts): string | undefined {
  return facts.ownOpenPrs()?.find((p) => !p.landRequested)?.pr;
}

// The report body as sent: `--body` text (a `$(cat f)` or `$(<f)` body read from f) or `--body-file`.
function body(argv: readonly string[], cwd: string, facts: Facts): string {
  const read = (path: string) => facts.readScript(isAbsolute(path) ? path : join(cwd, path)) ?? "";
  const file = option(argv, "--body-file");
  if (file !== undefined) return read(file);
  const text = option(argv, "--body") ?? "";
  const cat = /^\$\(\s*(?:cat\s+|<\s*)(['"]?)([^'"\s)]+)\1\s*\)$/.exec(text.trim());
  return cat ? read(cat[2] ?? "") : text;
}

// `gh api -X PUT repos/o/r/pulls/N/merge` is the same merge as `gh pr merge`.
function apiMerge(argv: readonly string[]): boolean {
  if (!argv.some((a) => /(^|\/)pulls\/\d+\/merge$/.test(a))) return false;
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
    const done =
      argv[0] === "orca" &&
      pos[1] === "orchestration" &&
      pos[2] === "send" &&
      option(argv, "--type") === "worker_done" &&
      option(argv, "--outcome") !== "failed";
    if (done && facts.role() === "worker" && !WAIT_LINE.test(body(argv, call.cwd, facts))) {
      const pr = openWithoutLand(facts);
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
