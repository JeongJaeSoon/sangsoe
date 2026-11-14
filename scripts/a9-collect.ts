// Probe A9 (decision 261): did Orca message delivery alone wake a top-level orchestrator session?
// Token-free, read-only. Inputs are the two records that already exist, the Orca inbox rows of the probe's
// mailbox (`orca orchestration inbox --terminal <mailbox> --full --json`) and the session transcript(s);
// the result is a table on stdout. Nothing is written anywhere.
//
//   node scripts/a9-collect.ts <inbox.json> <transcript.jsonl>... [--subject-prefix "A9 probe"]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_LATENCY_S = 120;
export const MAX_MIDTURN_S = 60;
const WAKE_LINE = /You have \d+ orchestration message/;

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

export interface InboxRow {
  id: string;
  subject?: string;
  createdAt?: string | number;
  created_at?: string | number;
  readAt?: string | number | null;
  read_at?: string | number | null;
}

const when = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isNaN(n) ? null : n;
};

export function collect(inbox: InboxRow[], transcriptFiles: string[], subjectPrefix = ""): Row[] {
  const lines = parseTranscript(transcriptFiles);
  const span = turns(lines);
  const rows: Row[] = [];
  for (const m of inbox) {
    if (subjectPrefix && !(m.subject ?? "").startsWith(subjectPrefix)) continue;
    const created = when(m.createdAt ?? m.created_at);
    if (created === null) continue;
    const read = when(m.readAt ?? m.read_at);
    const turn = span.find((t) => created >= t.start && created <= t.end);
    const kind: Kind = turn ? "mid-turn" : "idle";
    // Join key: the message id in the transcript (a `check` result), else the wake line the delivery inserted.
    const idHits = lines.filter((l) => l.role === "user" && l.ts >= created && l.text.includes(m.id));
    const wakeHits = lines.filter((l) => l.role === "user" && !l.toolResult && l.ts >= created && WAKE_LINE.test(l.text));
    const seen = idHits.length > 0 ? idHits : wakeHits.slice(0, 1);
    const base = { id: m.id, createdAt: created, kind };
    if (read === null) {
      rows.push({ ...base, outcome: "unread", latencyS: null });
      continue;
    }
    // Duplicate handling counts only distinct ids hits in separate lines, never the wake line next to them.
    if (idHits.filter((l) => l.toolResult).length > 1) {
      rows.push({ ...base, outcome: "duplicate", latencyS: null });
      continue;
    }
    const from = kind === "mid-turn" && turn ? turn.end : created;
    const first = seen[0];
    const act = first && lines.find((l) => l.role === "assistant" && l.toolUse && l.ts >= from && l.ts >= first.ts);
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
  const head = "id\tcreated_at\tkind\toutcome\tlatency_s";
  const body = rows.map((r) => [r.id, new Date(r.createdAt).toISOString(), r.kind, r.outcome, r.latencyS?.toFixed(1) ?? "-"].join("\t"));
  const v = verdict(rows);
  return [head, ...body, `sends=${v.total} failed=${v.failed} max_latency_s=${v.maxLatencyS.toFixed(1)} pass=${v.pass}`].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--subject-prefix");
  const prefix = i >= 0 ? (args.splice(i, 2)[1] ?? "") : "";
  const [inboxFile, ...transcripts] = args;
  if (!inboxFile || transcripts.length === 0) {
    console.error("usage: a9-collect.ts <inbox.json> <transcript.jsonl>... [--subject-prefix <text>]");
    process.exit(2);
  }
  const parsed = JSON.parse(readFileSync(inboxFile, "utf8")) as { result?: { messages?: InboxRow[] }; messages?: InboxRow[] };
  console.log(table(collect(parsed.result?.messages ?? parsed.messages ?? [], transcripts, prefix)));
}
