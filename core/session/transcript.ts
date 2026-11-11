import { closeSync, fstatSync, openSync, readSync } from "node:fs";

// Claude Code's transcript is JSONL whose record shapes are not documented (P13). Every reader here
// returns nothing for a shape it does not know, so a format change costs a missed record, never a wrong one.

const TAIL_BYTES = 256 * 1024;

type Rec = {
  type?: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  message?: { content?: unknown; usage?: Record<string, unknown> };
  compactMetadata?: { preTokens?: unknown };
};

/** The records in the last TAIL_BYTES of the file; the first, possibly cut, line is dropped. */
export function tail(path: string | undefined, bytes = TAIL_BYTES): Rec[] {
  if (!path) return [];
  let text: string;
  try {
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      text = buf.toString("utf8", 0, readSync(fd, buf, 0, buf.length, start));
      if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
  const out: Rec[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r = JSON.parse(line) as unknown;
      if (r && typeof r === "object" && !Array.isArray(r)) out.push(r as Rec);
    } catch {
      // A partial last line is skipped.
    }
  }
  return out;
}

/**
 * The records anywhere in the file whose line contains `marker`: one long autonomous turn can push
 * a record far past the tail, and only marked lines are parsed. Read in chunks: a transcript can
 * pass the largest string Node holds.
 */
export function marked(path: string | undefined, marker: string, chunk = 1 << 20): Rec[] {
  if (!path) return [];
  const out: Rec[] = [];
  const take = (line: Buffer) => {
    if (!line.includes(marker)) return;
    try {
      const r = JSON.parse(line.toString("utf8")) as unknown;
      if (r && typeof r === "object" && !Array.isArray(r)) out.push(r as Rec);
    } catch {
      // A partial last line is skipped.
    }
  };
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(chunk);
      let rest = Buffer.alloc(0);
      for (let n = readSync(fd, buf, 0, chunk, null); n > 0; n = readSync(fd, buf, 0, chunk, null)) {
        let data = Buffer.concat([rest, buf.subarray(0, n)]);
        for (let nl = data.indexOf(10); nl >= 0; nl = data.indexOf(10)) {
          take(data.subarray(0, nl));
          data = data.subarray(nl + 1);
        }
        rest = Buffer.from(data);
      }
      take(rest);
    } finally {
      closeSync(fd);
    }
  } catch {
    return out;
  }
  return out;
}

export interface ShellInput {
  readonly uuid: string;
  readonly ts: string | undefined;
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
}

const between = (s: string, tag: string): string | undefined => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(s);
  return m?.[1];
};

/**
 * The owner's `!` commands: a user record whose content is `<bash-input>…</bash-input>`, paired with the
 * child record (parentUuid) carrying `<bash-stdout>` and `<bash-stderr>`. Claude Code 2.1.310 writes no
 * exit code (P13). An input without its output yet is left for the next read.
 */
export function shellInputs(records: readonly Rec[]): ShellInput[] {
  const content = (r: Rec) => (r.type === "user" && typeof r.message?.content === "string" ? r.message.content : undefined);
  const outputs = new Map<string, string>();
  for (const r of records) {
    const c = content(r);
    if (c?.startsWith("<bash-stdout>") && typeof r.parentUuid === "string") outputs.set(r.parentUuid, c);
  }
  const out: ShellInput[] = [];
  for (const r of records) {
    const c = content(r);
    if (!c?.startsWith("<bash-input>") || typeof r.uuid !== "string") continue;
    const command = between(c, "bash-input")?.trim();
    const o = outputs.get(r.uuid);
    if (!command || o === undefined) continue;
    out.push({ uuid: r.uuid, ts: r.timestamp, command, stdout: between(o, "bash-stdout") ?? "", stderr: (between(o, "bash-stderr") ?? "").trim() });
  }
  return out;
}

/** The context size of the last model call: its input plus cache tokens. */
export function lastContextTokens(records: readonly Rec[]): number | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const u = records[i]?.message?.usage;
    if (records[i]?.type !== "assistant" || !u) continue;
    const n = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].reduce(
      (sum, k) => sum + (Number.isInteger(u[k]) ? (u[k] as number) : 0),
      0,
    );
    return n > 0 ? n : undefined;
  }
  return undefined;
}

/** preTokens of the last compact_boundary record (P9: PostCompact's input carries no size). */
export function lastPreTokens(records: readonly Rec[]): number | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r?.type === "system" && r.subtype === "compact_boundary") {
      const n = r.compactMetadata?.preTokens;
      return Number.isInteger(n) && (n as number) > 0 ? (n as number) : undefined;
    }
  }
  return undefined;
}
