import { isAbsolute, join } from "node:path";

// Reads a Bash command the way the gates need it: simple commands with their words, whether each runs in
// the background, and the loop keywords. Not a full shell parser: what it cannot read stays words, and the
// gates only ever deny on a shape they recognise, so an unreadable command passes rather than blocks.

export type Simple = {
  words: string[];
  /** Part of a pipeline, and-or list or group that ended with a single `&`. */
  background: boolean;
  /** Text run by `bash -c` or `eval` under a wrapper that outlives the shell (`nohup`, `setsid`). */
  detached?: boolean;
};

export type Parsed = { commands: Simple[]; loops: boolean };

const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "for", "case", "esac", "!", "{", "}", "time"]);
const LOOP = new Set(["while", "until", "for"]);
const OPENS = new Set(["{", "if", "while", "until", "for", "case"]);
const CLOSES = new Set(["}", "fi", "done", "esac"]);

/** Drops heredoc bodies: their lines are data, not commands. */
function stripHeredocs(text: string): string {
  const out: string[] = [];
  let end: { word: string; dash: boolean } | null = null;
  for (const line of text.split("\n")) {
    if (end) {
      if ((end.dash ? line.replace(/^\t+/, "") : line) === end.word) end = null;
      continue;
    }
    out.push(line);
    const m = /<<(-?)\s*(['"]?)([\w.-]+)\2/.exec(line.replace(/<<</g, ""));
    if (m) end = { word: m[3] ?? "", dash: m[1] === "-" };
  }
  return out.join("\n");
}

/** Reads `$(...)` or a backtick span starting at i; returns its inner text and the index after it. */
function substitution(s: string, i: number): { inner: string; next: number } {
  if (s[i] === "`") {
    const close = s.indexOf("`", i + 1);
    const end = close === -1 ? s.length : close;
    return { inner: s.slice(i + 1, end), next: end + 1 };
  }
  let depth = 0;
  let quote: string | null = null;
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return { inner: s.slice(i + 2, j), next: j + 1 };
  }
  return { inner: s.slice(i + 2), next: s.length };
}

export function parse(text: string, depth = 0): Parsed {
  const s = stripHeredocs(text);
  const commands: Simple[] = [];
  // Each substitution's commands with the index of the command that holds it.
  const nested: { parsed: Parsed; owner: number }[] = [];
  const sub = (inner: string) => {
    if (depth < 3) nested.push({ parsed: parse(inner, depth + 1), owner: commands.length });
  };
  let loops = false;
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let skipNext = false;
  // A trailing `&` backgrounds the whole and-or list before it, back to the last `;`, newline or `&`;
  // a group, loop, `if` or `case` closed just before it counts as one command.
  let listStart = 0;
  const groups: { start: number; kind: string }[] = [];
  const open = (kind: string) => groups.push({ start: commands.length, kind });
  const close = () => {
    const g = groups.pop();
    if (g) listStart = Math.min(listStart, g.start);
  };

  const flushWord = () => {
    if (!inWord) return;
    if (skipNext) skipNext = false;
    else if (words.length === 0 && KEYWORDS.has(word)) {
      if (LOOP.has(word)) loops = true;
      if (OPENS.has(word)) open(word);
      if (CLOSES.has(word)) close();
    } else words.push(word);
    word = "";
    inWord = false;
  };
  const flushCommand = () => {
    flushWord();
    if (words.length > 0) commands.push({ words, background: false });
    words = [];
  };
  const endList = (background: boolean) => {
    flushCommand();
    if (background) for (let k = listStart; k < commands.length; k++) (commands[k] as Simple).background = true;
    listStart = commands.length;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? "";
    const n = s[i + 1] ?? "";
    if (c === "\\" && i + 1 < s.length) {
      if (n !== "\n") word += n;
      inWord = true;
      i++;
    } else if (c === "'") {
      const close = s.indexOf("'", i + 1);
      const end = close === -1 ? s.length : close;
      word += s.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === "\\" && j + 1 < s.length) {
          word += s[++j];
        } else if ((s[j] === "$" && s[j + 1] === "(") || s[j] === "`") {
          const span = substitution(s, j);
          sub(span.inner);
          word += s.slice(j, span.next);
          j = span.next - 1;
        } else word += s[j];
      }
      inWord = true;
      i = j;
    } else if ((c === "$" && n === "(") || c === "`") {
      const span = substitution(s, i);
      sub(span.inner);
      word += s.slice(i, span.next);
      inWord = true;
      i = span.next - 1;
    } else if (c === "#" && !inWord) {
      const nl = s.indexOf("\n", i);
      i = nl === -1 ? s.length : nl - 1;
    } else if (c === ">" || c === "<" || (c === "&" && n === ">")) {
      if (inWord && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      } else flushWord();
      let j = i + 1;
      while (s[j] === ">" || s[j] === "<" || s[j] === "&" || s[j] === "|") j++;
      if (s[j - 1] === "&") while (/[\d-]/.test(s[j] ?? "")) j++;
      // `2>&1` names no file; any other redirection's next word is its target, not an argument.
      if (!/&[\d-]*$/.test(s.slice(i, j)) || c === "&") skipNext = true;
      i = j - 1;
    } else if ((c === "&" && n === "&") || (c === "|" && (n === "|" || n === "&"))) {
      flushCommand();
      i++;
    } else if (c === "&") {
      endList(true);
    } else if (c === ";" || c === "\n") {
      endList(false);
    } else if (c === "|") {
      flushCommand();
    } else if (c === "(") {
      flushCommand();
      open("(");
    } else if (c === ")") {
      flushCommand();
      // A case pattern's `)` closes nothing.
      if (groups.at(-1)?.kind !== "case") close();
    } else if (c === " " || c === "\t") {
      flushWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endList(false);

  for (const { parsed: p, owner } of nested) {
    const holder = commands[owner];
    const detached = holder ? holder.detached || unwrap(holder.words).detached : false;
    commands.push(
      ...p.commands.map((x) => ({
        ...x,
        background: x.background || (holder?.background ?? false),
        detached: x.detached || detached,
      })),
    );
    loops ||= p.loops;
  }
  // `bash -c '<script>'` and `eval` run text: read that text as commands too.
  for (const cmd of [...commands]) {
    const { argv, detached } = unwrap(cmd.words);
    const inner = shellText(argv);
    if (inner !== undefined && depth < 3) {
      const p = parse(inner, depth + 1);
      commands.push(
        ...p.commands.map((x) => ({
          ...x,
          background: x.background || cmd.background,
          detached: x.detached || cmd.detached || detached,
        })),
      );
      loops ||= p.loops;
    }
  }
  return { commands, loops };
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

function shellText(argv: readonly string[]): string | undefined {
  const [head, ...rest] = argv;
  if (head === "eval") return rest.join(" ");
  if (!head || !SHELLS.has(head)) return undefined;
  const flag = rest.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
  return flag === -1 ? undefined : rest[flag + 1];
}

/** A path as the command names it, against cwd; `~/` and `$HOME/` are left for the reader to expand. */
export function againstCwd(cwd: string, path: string): string {
  return isAbsolute(path) || /^(~|\$HOME|\$\{HOME\})\//.test(path) ? path : join(cwd, path);
}

/** The script file a command runs (`sh x.sh`, `source x.sh`, `./bin/x`, `x.sh`), if any. */
export function scriptPath({ argv, path }: Argv): string | undefined {
  const [head, ...rest] = argv;
  if (!head) return undefined;
  if (/^\.{1,2}\//.test(path) || path.endsWith(".sh")) return path;
  if (head === "source" || head === ".") return rest[0];
  if (SHELLS.has(head)) {
    if (rest.some((a) => /^-[a-z]*c[a-z]*$/.test(a))) return undefined;
    return rest.find((a) => !a.startsWith("-"));
  }
  return undefined;
}

// Prefixes that run the rest of the line as the command; `detach` marks the ones that outlive the shell.
const PREFIX: Record<string, { args: RegExp | null; detach: boolean }> = {
  env: { args: /^(-\S*|\w+=.*)$/, detach: false },
  nohup: { args: null, detach: true },
  setsid: { args: /^-\S*$/, detach: true },
  exec: { args: /^-\S*$/, detach: false },
  command: { args: /^-\S*$/, detach: false },
  builtin: { args: null, detach: false },
  nice: { args: /^(-n|-?\d+|--adjustment=\S*)$/, detach: false },
  sudo: { args: /^-\S*$/, detach: false },
  caffeinate: { args: /^-\S*$/, detach: false },
  stdbuf: { args: /^-\S*$/, detach: false },
  timeout: { args: /^(-\S*|\d+(\.\d+)?[smhd]?)$/, detach: false },
  time: { args: /^-\S*$/, detach: false },
};

/** `path` is the command word as written (`./bin/go.sh`); argv[0] is its base name. */
export type Argv = { argv: string[]; path: string; detached: boolean };

/** Strips assignments and runner prefixes, and reduces the command word to its base name. */
export function unwrap(words: readonly string[]): Argv {
  let i = 0;
  let detached = false;
  while (i < words.length) {
    const w = words[i] ?? "";
    if (/^\w+=/.test(w)) {
      i++;
      continue;
    }
    const base = w.slice(w.lastIndexOf("/") + 1);
    const p = PREFIX[base];
    if (!p) break;
    detached ||= p.detach;
    i++;
    // `timeout`'s duration and `nice -n N` take a value.
    while (i < words.length && p.args?.test(words[i] ?? "")) {
      if ((base === "nice" && words[i] === "-n") || (base === "sudo" && words[i] === "-u")) i++;
      i++;
    }
  }
  const argv = words.slice(i);
  const path = argv[0] ?? "";
  if (argv[0]) argv[0] = path.slice(path.lastIndexOf("/") + 1);
  return { argv, path, detached };
}

/** Value of `--name value` or `--name=value`. */
export function option(argv: readonly string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === name) return argv[i + 1];
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return undefined;
}

export const has = (argv: readonly string[], name: string) => argv.some((a) => a === name || a.startsWith(`${name}=`));
