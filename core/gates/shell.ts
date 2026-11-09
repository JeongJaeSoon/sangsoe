// Reads a Bash command the way the gates need it: simple commands with their words, whether each runs in
// the background, and the loop keywords. Not a full shell parser: what it cannot read stays words, and the
// gates only ever deny on a shape they recognise, so an unreadable command passes rather than blocks.

export type Simple = {
  words: string[];
  /** Ended with a single `&`. */
  background: boolean;
};

export type Parsed = { commands: Simple[]; loops: boolean };

const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "for", "!", "{", "}", "time"]);
const LOOP = new Set(["while", "until", "for"]);

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
  const nested: Parsed[] = [];
  let loops = false;
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let skipNext = false;

  const flushWord = () => {
    if (!inWord) return;
    if (skipNext) skipNext = false;
    else {
      if (words.length === 0 && LOOP.has(word)) loops = true;
      if (words.length === 0 && KEYWORDS.has(word)) {
        if (LOOP.has(word)) loops = true;
      } else words.push(word);
    }
    word = "";
    inWord = false;
  };
  const flushCommand = (background: boolean) => {
    flushWord();
    if (words.length > 0) commands.push({ words, background });
    words = [];
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
          const sub = substitution(s, j);
          if (depth < 3) nested.push(parse(sub.inner, depth + 1));
          word += s.slice(j, sub.next);
          j = sub.next - 1;
        } else word += s[j];
      }
      inWord = true;
      i = j;
    } else if ((c === "$" && n === "(") || c === "`") {
      const sub = substitution(s, i);
      if (depth < 3) nested.push(parse(sub.inner, depth + 1));
      word += s.slice(i, sub.next);
      inWord = true;
      i = sub.next - 1;
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
    } else if (c === "&" && n === "&") {
      flushCommand(false);
      i++;
    } else if (c === "|" && n === "|") {
      flushCommand(false);
      i++;
    } else if (c === "&") {
      flushCommand(true);
    } else if (c === ";" || c === "\n" || c === "|" || c === "(" || c === ")") {
      flushCommand(false);
    } else if (c === " " || c === "\t") {
      flushWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  flushCommand(false);

  for (const p of nested) {
    commands.push(...p.commands);
    loops ||= p.loops;
  }
  // `bash -c '<script>'` and `eval` run text: read that text as commands too.
  for (const cmd of [...commands]) {
    const { argv } = unwrap(cmd.words);
    const inner = shellText(argv);
    if (inner !== undefined && depth < 3) {
      const p = parse(inner, depth + 1);
      commands.push(...p.commands.map((x) => ({ ...x, background: x.background || cmd.background })));
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
