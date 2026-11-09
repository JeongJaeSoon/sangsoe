import { VERSION } from "../../../core/index.ts";
import type { Outcome } from "../../../claude-plugin/mcp/contract.ts";

// Stands in for a core function: the fixture tool and command both call it, and `writes`
// is its only side effect, so a test sees whether an entrance reached it.
export const writes: string[] = [];

export function greet(who: string, refuse: boolean): Outcome {
  if (refuse) {
    return {
      ok: false,
      refusal: { code: "greet_refused", reason: "the caller asked for a refusal", fix: "call greet without refuse" },
    };
  }
  writes.push(who);
  return { ok: true, value: { greeting: `hello ${who}`, version: VERSION } };
}
