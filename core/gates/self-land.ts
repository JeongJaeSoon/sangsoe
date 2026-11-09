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

export const selfLandGate: Gate = (call, facts) => {
  if (call.tool !== "Bash") return null;
  const text = String(call.input.command ?? "");
  for (const cmd of parse(text).commands) {
    const { argv } = unwrap(cmd.words);
    const pos = argv.filter((a) => !a.startsWith("-"));
    if (argv[0] === "gh" && pos[1] === "pr" && pos[2] === "merge" && facts.role() !== "general") {
      return verdict(`A direct merge skips the land checks. Merge through ${LAND}.`);
    }
    const done =
      argv[0] === "orca" &&
      pos[1] === "orchestration" &&
      pos[2] === "send" &&
      option(argv, "--type") === "worker_done" &&
      option(argv, "--outcome") !== "failed";
    if (done && !WAIT_LINE.test(text) && facts.role() === "worker") {
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
