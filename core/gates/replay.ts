import { evaluate, type HookInput, parseHookInput, roleOf } from "./index.ts";
import type { Facts, OpenPr, Role } from "./types.ts";

// R-09: false positives and false negatives measured on a collection of real commands. Each line is a
// PreToolUse input plus `expect` (deny|pass), the `gate` expected to deny, and the facts the line assumes.

type LineFacts = { role?: Role; load?: "ok" | "warn" | "danger"; openPrs?: OpenPr[]; scripts?: Record<string, string> };
type Line = Omit<HookInput, "cwd"> & { expect: "deny" | "pass"; gate?: string; note?: string; facts?: LineFacts };

export type ReplayRow = { n: number; note: string; expect: "deny" | "pass"; got: string; gates: string[]; ok: boolean };
export type ReplayCounts = { lines: number; deny: number; pass: number; falsePositive: number; falseNegative: number; wrongGate: number };

export const REPLAY_CWD = "/work/acme";

function factsOf(line: Line): Facts {
  const f = line.facts ?? {};
  return {
    role: () => f.role ?? roleOf(line.agent_type, () => undefined),
    load: () => ({ level: f.load ?? "ok", reasons: f.load && f.load !== "ok" ? [`replayed ${f.load}`] : [] }),
    ownOpenPrs: () => f.openPrs,
    readScript: (p) => f.scripts?.[p],
  };
}

export function replay(jsonl: string): { rows: ReplayRow[]; counts: ReplayCounts } {
  const rows: ReplayRow[] = [];
  jsonl.split("\n").forEach((text, i) => {
    if (text.trim() === "") return;
    const line = JSON.parse(text) as Line;
    const parsed = parseHookInput(JSON.stringify({ cwd: REPLAY_CWD, ...line }));
    if (!parsed.ok) throw new Error(`line ${i + 1}: ${parsed.reason}`);
    const m = evaluate(parsed.call, factsOf(line));
    const got = m.decision === "deny" ? "deny" : "pass";
    const gates = m.verdicts.filter((v) => v.decision === "deny").map((v) => v.gate);
    const ok = got === line.expect && (line.expect === "pass" || !line.gate || gates.includes(line.gate as never));
    rows.push({ n: i + 1, note: line.note ?? "", expect: line.expect, got, gates, ok });
  });
  const counts: ReplayCounts = {
    lines: rows.length,
    deny: rows.filter((r) => r.expect === "deny").length,
    pass: rows.filter((r) => r.expect === "pass").length,
    falsePositive: rows.filter((r) => r.expect === "pass" && r.got === "deny").length,
    falseNegative: rows.filter((r) => r.expect === "deny" && r.got === "pass").length,
    wrongGate: rows.filter((r) => r.expect === "deny" && r.got === "deny" && !r.ok).length,
  };
  return { rows, counts };
}
