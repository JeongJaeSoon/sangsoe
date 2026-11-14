// Probe A9 (decision 261): did Orca message delivery alone wake a top-level orchestrator session?
// Token-free, read-only. Two records that already exist are joined by Orca's messageId; nothing is stored:
//   sender side   the sending session's transcript: the `orca orchestration send` result (messageId=...) and its time
//   receiver side the probe session's transcript(s): the `check` tool_result that carries the id, and the first tool call
// The result is a table on stdout.
//
//   node scripts/a9-collect.ts <sender.jsonl> <probe.jsonl>... [--subject-prefix "A9 probe"]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_LATENCY_S = 120;
export const MAX_MIDTURN_S = 60;

export type Outcome = "woken" | "unread" | "no-action" | "slow" | "duplicate";
export type Kind = "idle" | "mid-turn";

export interface Row {
  id: string;
  createdAt: number;
  kind: Kind;
  outcome: Outcome;
  latencyS: number | null;
}

interface Line {
  ts: number;
  role: "user" | "assistant" | "other";
  text: string;
  toolUse: boolean;
  toolResult: boolean;
  endTurn: boolean;
  commands: { id: string; command: string }[];
  resultIds: string[];
}

function parseTranscript(files: string[]): Line[] {
  const lines: Line[] = [];
  for (const file of files) {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      if (!raw.trim()) continue;
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      const ts = Date.parse(String(o.timestamp ?? ""));
      if (Number.isNaN(ts)) continue;
      const msg = (o.message ?? {}) as { content?: unknown; stop_reason?: string };
      const parts = Array.isArray(msg.content) ? (msg.content as Record<string, unknown>[]) : [];
      lines.push({
        ts,
        role: o.type === "user" || o.type === "assistant" ? o.type : "other",
        text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
        toolUse: parts.some((p) => p.type === "tool_use"),
        toolResult: parts.some((p) => p.type === "tool_result"),
        endTurn: msg.stop_reason === "end_turn",
        commands: parts
          .filter((p) => p.type === "tool_use")
          .map((p) => ({ id: String(p.id ?? ""), command: String((p.input as { command?: unknown } | undefined)?.command ?? "") })),
        resultIds: parts.filter((p) => p.type === "tool_result").map((p) => String(p.tool_use_id ?? "")),
      });
    }
  }
  return lines.sort((a, b) => a.ts - b.ts);
}

// A turn runs from a real prompt (a user line that is not a tool result) to the assistant line that ends it.
function turns(lines: Line[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (const l of lines) {
    if (l.role === "user" && !l.toolResult && start === null) start = l.ts;
    else if (l.role === "assistant" && l.endTurn && start !== null) {
      out.push({ start, end: l.ts });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: Number.POSITIVE_INFINITY });
  return out;
}

export interface Send {
  id: string;
  sentAt: number;
}

// The sends are the `orca orchestration send` calls (whose command contains the prefix) with the messageId Orca returned.
export function sends(senderFiles: string[], subjectPrefix = ""): Send[] {
  const lines = parseTranscript(senderFiles);
  const wanted = new Map<string, true>();
  for (const l of lines) {
    for (const c of l.commands) {
      if (c.command.includes("orchestration send") && c.command.includes(subjectPrefix)) wanted.set(c.id, true);
    }
  }
  const out: Send[] = [];
  for (const l of lines) {
    if (!l.toolResult || !l.resultIds.some((id) => wanted.has(id))) continue;
    const m = /messageId=(msg_[A-Za-z0-9]+)/.exec(l.text);
    if (m?.[1]) out.push({ id: m[1], sentAt: l.ts });
  }
  return out;
}

export function collect(sent: Send[], probeFiles: string[]): Row[] {
  const lines = parseTranscript(probeFiles);
  const span = turns(lines);
  const rows: Row[] = [];
  for (const s of sent) {
    const turn = span.find((t) => s.sentAt >= t.start && s.sentAt <= t.end);
    const kind: Kind = turn ? "mid-turn" : "idle";
    const base = { id: s.id, createdAt: s.sentAt, kind };
    const hits = lines.filter((l) => l.role === "user" && l.toolResult && l.ts >= s.sentAt && l.text.includes(s.id));
    if (hits.length === 0) {
      rows.push({ ...base, outcome: "unread", latencyS: null });
      continue;
    }
    if (hits.length > 1) {
      rows.push({ ...base, outcome: "duplicate", latencyS: null });
      continue;
    }
    const from = kind === "mid-turn" && turn ? turn.end : s.sentAt;
    const act = lines.find((l) => l.role === "assistant" && l.toolUse && l.ts >= from);
    if (!act) {
      rows.push({ ...base, outcome: "no-action", latencyS: null });
      continue;
    }
    const latencyS = (act.ts - from) / 1000;
    const limit = kind === "mid-turn" ? MAX_MIDTURN_S : MAX_LATENCY_S;
    rows.push({ ...base, outcome: latencyS > limit ? "slow" : "woken", latencyS });
  }
  return rows;
}

export interface Verdict {
  pass: boolean;
  total: number;
  failed: number;
  maxLatencyS: number;
}

// The approved pass rule: every send woken (none unread, lost, slow or processed twice); max latency within the limits.
export function verdict(rows: Row[]): Verdict {
  const failed = rows.filter((r) => r.outcome !== "woken").length;
  const maxLatencyS = rows.reduce((m, r) => Math.max(m, r.latencyS ?? 0), 0);
  return { pass: rows.length > 0 && failed === 0, total: rows.length, failed, maxLatencyS };
}

export function table(rows: Row[]): string {
  const head = "id\tsent_at\tkind\toutcome\tlatency_s";
  const body = rows.map((r) => [r.id, new Date(r.createdAt).toISOString(), r.kind, r.outcome, r.latencyS?.toFixed(1) ?? "-"].join("\t"));
  const v = verdict(rows);
  return [head, ...body, `sends=${v.total} failed=${v.failed} max_latency_s=${v.maxLatencyS.toFixed(1)} pass=${v.pass}`].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--subject-prefix");
  const prefix = i >= 0 ? (args.splice(i, 2)[1] ?? "") : "";
  const [senderFile, ...probe] = args;
  if (!senderFile || probe.length === 0) {
    console.error("usage: a9-collect.ts <sender.jsonl> <probe.jsonl>... [--subject-prefix <text>]");
    process.exit(2);
  }
  console.log(table(collect(sends([senderFile], prefix), probe)));
}
