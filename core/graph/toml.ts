// The TOML subset flow templates use (the core has no runtime dependencies, decision 0098): `key =
// value` lines, `[table]` / `[a.b]` / `[[array]]` headers, values that are double-quoted strings,
// integers, booleans, one-line arrays and one-line inline tables, `#` comments. Anything else is
// refused with its line number rather than read loosely.

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export class TomlError extends Error {
  override name = "TomlError";
}

const BARE = /^[A-Za-z0-9_-]+$/;

class Cursor {
  i = 0;
  readonly s: string;
  readonly line: number;
  constructor(s: string, line: number) {
    this.s = s;
    this.line = line;
  }
  fail(msg: string): never {
    throw new TomlError(`line ${this.line}: ${msg}`);
  }
  ws(): void {
    while (this.s[this.i] === " " || this.s[this.i] === "\t") this.i++;
  }
  eat(c: string): boolean {
    this.ws();
    if (this.s[this.i] !== c) return false;
    this.i++;
    return true;
  }
  key(): string {
    this.ws();
    if (this.s[this.i] === '"') return this.string();
    const m = /^[A-Za-z0-9_-]+/.exec(this.s.slice(this.i));
    if (!m) this.fail(`expected a key at ${JSON.stringify(this.s.slice(this.i))}`);
    this.i += m[0].length;
    return m[0];
  }
  string(): string {
    this.i++;
    let out = "";
    for (;;) {
      const c = this.s[this.i++];
      if (c === undefined) this.fail("unterminated string");
      if (c === '"') return out;
      if (c === "\\") {
        const e = this.s[this.i++];
        const map: Record<string, string> = { n: "\n", t: "\t", '"': '"', "\\": "\\" };
        if (e === undefined || !(e in map)) this.fail(`unsupported escape \\${e ?? ""}`);
        out += map[e];
      } else out += c;
    }
  }
  value(): TomlValue {
    this.ws();
    const c = this.s[this.i];
    if (c === '"') {
      if (this.s.startsWith('"""', this.i)) this.fail("multi-line strings are not in the subset");
      return this.string();
    }
    if (c === "[") {
      this.i++;
      const out: TomlValue[] = [];
      if (this.eat("]")) return out;
      for (;;) {
        out.push(this.value());
        if (this.eat("]")) return out;
        if (!this.eat(",")) this.fail("expected , or ] in an array");
        if (this.eat("]")) return out;
      }
    }
    if (c === "{") {
      this.i++;
      const out: TomlTable = {};
      if (this.eat("}")) return out;
      for (;;) {
        const k = this.key();
        if (!this.eat("=")) this.fail(`expected = after ${k}`);
        if (k in out) this.fail(`duplicate key ${k}`);
        out[k] = this.value();
        if (this.eat("}")) return out;
        if (!this.eat(",")) this.fail("expected , or } in an inline table");
      }
    }
    const m = /^(true|false|[+-]?[0-9]+)(?=[\s,\]}#]|$)/.exec(this.s.slice(this.i));
    if (!m) this.fail(`unsupported value ${JSON.stringify(this.s.slice(this.i))}`);
    this.i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : Number(m[0]);
  }
  end(): void {
    this.ws();
    if (this.i < this.s.length && this.s[this.i] !== "#") this.fail(`unexpected ${JSON.stringify(this.s.slice(this.i))}`);
  }
}

function descend(root: TomlTable, path: readonly string[], line: number): TomlTable {
  let t = root;
  for (const k of path) {
    const next = t[k] ?? {};
    t[k] = next;
    const target = Array.isArray(next) ? next[next.length - 1] : next;
    if (typeof target !== "object" || target === null || Array.isArray(target)) throw new TomlError(`line ${line}: ${k} is not a table`);
    t = target as TomlTable;
  }
  return t;
}

export function parseToml(text: string): TomlTable {
  const root: TomlTable = {};
  let current = root;
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = idx + 1;
    const c = new Cursor(raw, line);
    c.ws();
    if (c.i >= raw.length || raw[c.i] === "#") return;
    const header = (re: RegExp, what: string): string[] => {
      const name = re.exec(raw.slice(c.i))?.[1];
      const path = name?.split(".") ?? [];
      if (path.length === 0 || !path.every((p) => BARE.test(p))) throw new TomlError(`line ${line}: bad ${what} header`);
      return path;
    };
    if (raw.startsWith("[[", c.i)) {
      const path = header(/^\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]\s*(#.*)?$/, "[[array]]");
      const parent = descend(root, path.slice(0, -1), line);
      const k = path[path.length - 1] as string;
      const arr = parent[k] ?? [];
      parent[k] = arr;
      if (!Array.isArray(arr)) throw new TomlError(`line ${line}: ${k} is not an array of tables`);
      const t: TomlTable = {};
      arr.push(t);
      current = t;
      return;
    }
    if (raw[c.i] === "[") {
      current = descend(root, header(/^\[\s*([A-Za-z0-9_.-]+)\s*\]\s*(#.*)?$/, "[table]"), line);
      return;
    }
    const k = c.key();
    c.ws();
    if (raw[c.i] === ".") c.fail("dotted keys are not in the subset");
    if (!c.eat("=")) c.fail(`expected = after ${k}`);
    if (k in current) c.fail(`duplicate key ${k}`);
    current[k] = c.value();
    c.end();
  });
  return root;
}
