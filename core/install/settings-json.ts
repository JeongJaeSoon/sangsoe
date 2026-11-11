import { isDeepStrictEqual } from "node:util";

// Decision 221: rules go in and out of a settings.json as text splices, so every byte outside the
// spliced span (key order, other rules, indentation, a missing final newline) stays as it was.

type Span = { start: number; end: number };
type Node =
  | (Span & { kind: "object"; members: { key: string; keyStart: number; value: Node }[] })
  | (Span & { kind: "array"; items: Node[] })
  | (Span & { kind: "string"; value: string })
  | (Span & { kind: "other" });

function scan(text: string): Node {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\r\n".includes(text[i] ?? "")) i++;
  };
  const str = (): Span & { kind: "string"; value: string } => {
    const start = i++;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return { kind: "string", start, end: i, value: JSON.parse(text.slice(start, i)) as string };
  };
  const value = (): Node => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '"') return str();
    if (c === "{" || c === "[") {
      i++;
      const members: { key: string; keyStart: number; value: Node }[] = [];
      const items: Node[] = [];
      ws();
      while (text[i] !== (c === "{" ? "}" : "]")) {
        if (c === "{") {
          ws();
          const k = str();
          ws();
          i++; // ':'
          members.push({ key: k.value, keyStart: k.start, value: value() });
        } else items.push(value());
        ws();
        if (text[i] === ",") i++;
        ws();
      }
      i++;
      return c === "{" ? { kind: "object", start, end: i, members } : { kind: "array", start, end: i, items };
    }
    while (i < text.length && !",]} \t\r\n".includes(text[i] ?? "")) i++;
    return { kind: "other", start, end: i };
  };
  return value();
}

export type Parsed = { ok: true; value: unknown } | { ok: false; reason: string };

export function parseSettings(text: string): Parsed {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, reason: "the top level is not a JSON object" };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, reason: `not valid JSON (${(e as Error).message.replace(/\s+/g, " ")})` };
  }
}

const member = (n: Node | undefined, key: string) => (n?.kind === "object" ? n.members.find((m) => m.key === key)?.value : undefined);
const lineIndent = (text: string, pos: number) => /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", pos - 1) + 1))?.[0] ?? "";
const indentUnit = (text: string) => /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
const childStart = (n: Node, k: number) =>
  n.kind === "object" ? (n.members[k]?.keyStart ?? n.end) : n.kind === "array" ? (n.items[k]?.start ?? n.end) : n.end;
const childEnd = (n: Node, k: number) => (n.kind === "object" ? n.members[k]?.value.end : n.kind === "array" ? n.items[k]?.end : undefined) ?? n.end;
const count = (n: Node) => (n.kind === "object" ? n.members.length : n.kind === "array" ? n.items.length : 0);

/** Appends entries (each rendered for its own indent) after a container's last child, in its style. */
function appendTo(text: string, n: Node, entries: ((indent: string) => string)[]): string {
  const unit = indentUnit(text);
  const k = count(n);
  if (k === 0) {
    const outer = lineIndent(text, n.start);
    const inner = outer + unit;
    const body = entries.map((e) => `${inner}${e(inner)}`).join(",\n");
    return `${text.slice(0, n.start + 1)}\n${body}\n${outer}${text.slice(n.end - 1)}`;
  }
  const last = childEnd(n, k - 1);
  const oneLine = !text.slice(n.start, n.end).includes("\n");
  const ind = lineIndent(text, childStart(n, k - 1));
  const add = oneLine ? entries.map((e) => `, ${e(ind)}`).join("") : entries.map((e) => `,\n${ind}${e(ind)}`).join("");
  return text.slice(0, last) + add + text.slice(last);
}

/** Removes child k, taking the comma and line break that joined it to its neighbour. */
function removeAt(text: string, n: Node, k: number): string {
  if (count(n) === 1) return text.slice(0, n.start + 1) + text.slice(n.end - 1);
  if (k > 0) return text.slice(0, childEnd(n, k - 1)) + text.slice(childEnd(n, k));
  return text.slice(0, childStart(n, 0)) + text.slice(childStart(n, 1));
}

export type Created = "permissions" | "allow";

/**
 * `text` with `rules` appended to permissions.allow, creating either key when missing. Refuses
 * (undefined) when a key in the way is not of the expected type, or the result would not parse to
 * exactly the expected object.
 */
export function addRules(text: string, rules: readonly string[]): { text: string; created: Created[] } | undefined {
  const parsed = parseSettings(text);
  if (!parsed.ok || rules.length === 0) return undefined;
  const root = scan(text);
  const perms = member(root, "permissions");
  const allow = member(perms, "allow");
  const unit = indentUnit(text);
  const items = rules.map((r) => () => JSON.stringify(r));
  let out: string;
  let created: Created[];
  if (allow) {
    if (allow.kind !== "array") return undefined;
    out = appendTo(text, allow, items);
    created = [];
  } else {
    const allowEntry = (ind: string) => `"allow": [\n${rules.map((r) => `${ind}${unit}${JSON.stringify(r)}`).join(",\n")}\n${ind}]`;
    if (perms) {
      if (perms.kind !== "object") return undefined;
      out = appendTo(text, perms, [allowEntry]);
      created = ["allow"];
    } else {
      out = appendTo(text, root, [(ind) => `"permissions": {\n${ind}${unit}${allowEntry(ind + unit)}\n${ind}}`]);
      created = ["permissions", "allow"];
    }
  }
  const want = structuredClone(parsed.value) as { permissions?: { allow?: unknown[] } };
  want.permissions ??= {};
  want.permissions.allow = [...(want.permissions.allow ?? []), ...rules];
  const got = parseSettings(out);
  return got.ok && isDeepStrictEqual(got.value, want) ? { text: out, created } : undefined;
}

/**
 * `text` without the permissions.allow entries equal to one of `rules`, then without the keys in
 * `created` that are left empty. Returns which rules it found. Undefined when the text does not
 * parse or the result would not be the expected object.
 */
export function removeRules(text: string, rules: ReadonlySet<string>, created: readonly Created[]): { text: string; removed: string[] } | undefined {
  const parsed = parseSettings(text);
  if (!parsed.ok) return undefined;
  let out = text;
  const removed: string[] = [];
  const allowOf = () => member(member(scan(out), "permissions"), "allow");
  for (let a = allowOf(); a?.kind === "array"; a = allowOf()) {
    const k = a.items.findLastIndex((n) => n.kind === "string" && rules.has(n.value));
    const hit = a.items[k];
    if (hit?.kind !== "string") break;
    removed.unshift(hit.value);
    out = removeAt(out, a, k);
  }
  const dropEmpty = (parentOf: (root: Node) => Node | undefined, key: Created) => {
    const parent = parentOf(scan(out));
    if (parent?.kind !== "object") return;
    const k = parent.members.findIndex((m) => m.key === key);
    const v = parent.members[k]?.value;
    if (v && count(v) === 0 && (v.kind === "array" || v.kind === "object")) out = removeAt(out, parent, k);
  };
  if (created.includes("allow")) dropEmpty((root) => member(root, "permissions"), "allow");
  if (created.includes("permissions")) dropEmpty((root) => root, "permissions");

  const want = structuredClone(parsed.value) as Record<string, unknown> & { permissions?: Record<string, unknown> & { allow?: unknown } };
  const p = want.permissions;
  if (p && Array.isArray(p.allow)) {
    const left = [...removed];
    p.allow = p.allow.filter((r) => {
      const at = left.indexOf(r as string);
      if (at < 0) return true;
      left.splice(at, 1);
      return false;
    });
    if (created.includes("allow") && (p.allow as unknown[]).length === 0) delete p.allow;
  }
  if (created.includes("permissions") && p && Object.keys(p).length === 0) delete want.permissions;
  const got = parseSettings(out);
  return got.ok && isDeepStrictEqual(got.value, want) ? { text: out, removed } : undefined;
}

/** The rules a settings object lists in permissions.allow. */
export function allowList(settings: unknown): string[] {
  const allow = (settings as { permissions?: { allow?: unknown } } | undefined)?.permissions?.allow;
  return Array.isArray(allow) ? allow.filter((r): r is string => typeof r === "string") : [];
}
