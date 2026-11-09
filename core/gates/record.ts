import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../store/store.ts";
import type { HookInput } from "./index.ts";
import type { Merged } from "./merge.ts";

export function deniedDir(home: string): string {
  return join(home, ".local", "state", "sangsoe", "denied");
}

/**
 * R-10: every deny is one gate_denied per denying gate. The command text goes to a file and the event
 * holds its path, never the text (core/contract/events/gate_denied.ts). Shape checks carry their name in
 * `gate` (report-address), since the event has no reason field (decision 119).
 */
export function recordDenial(
  m: Merged,
  input: HookInput,
  home: string,
  store: Pick<Store, "append">,
  now: Date = new Date(),
): number {
  if (m.decision !== "deny") return 0;
  const dir = deniedDir(home);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${now.toISOString().replace(/[:.]/g, "-")}-${process.pid}.txt`);
  const command = input.tool_name === "Bash" ? String(input.tool_input.command ?? "") : JSON.stringify(input.tool_input);
  writeFileSync(file, `${input.tool_name}\n${command}\n`, { mode: 0o600 });
  for (const v of m.verdicts) {
    store.append({
      type: "gate_denied",
      source: "hook:pre-tool-use",
      ...(input.session_id ? { actor: input.session_id } : {}),
      payload: { gate: v.gate, command_file: file },
    });
  }
  return m.verdicts.length;
}
