// Display width as a terminal draws a Markdown table, ported from agent-skills' table_width.py:
// East Asian Wide/Fullwidth = 2, VS16 adds 1, combining marks and ZWJ add 0, a link counts its label.

// East_Asian_Width W and F ranges (Unicode 15), the subset a brief can contain.
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x303e],
  [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f320], [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440], [0x1f442, 0x1f4fc], [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e], [0x1f550, 0x1f567], [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df], [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb], [0x1f7f0, 0x1f7f0],
  [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945], [0x1f947, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
];

const isWide = (cp: number): boolean => WIDE.some(([a, b]) => cp >= a && cp <= b);
const COMBINING = /\p{Mn}|\p{Me}/u;

function charWidth(ch: string): number {
  if (ch === "️") return 1;
  if (ch === "‍" || COMBINING.test(ch)) return 0;
  return isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
}

/** Width of a cell's text as drawn: links count their label, ** and ` are not drawn. */
export function textWidth(s: string): number {
  const shown = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replaceAll("**", "").replaceAll("`", "");
  let w = 0;
  for (const ch of shown) w += charWidth(ch);
  return w;
}

/** Cut plain text to at most `max` cells, ending in … when cut. */
export function fit(s: string, max: number): string {
  if (textWidth(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

/** PR label rule (decision 89): owner/repo#N; over `max` drop the owner, then cut the repo keeping #N. */
export function prLabel(ref: string, max = 12): string {
  if (textWidth(ref) <= max) return ref;
  const [repoPart = ref, num = ""] = ref.split("#");
  const repo = repoPart.split("/").pop() ?? repoPart;
  const short = `${repo}#${num}`;
  if (textWidth(short) <= max) return short;
  return `${fit(repo, max - textWidth(`#${num}`))}#${num}`;
}

export function prUrl(ref: string): string {
  const [repo, num] = ref.split("#");
  return `https://github.com/${repo}/pull/${num}`;
}

/** 45m · 17h · 3d: minutes under two hours, hours under two days, then days. */
export function since(from: string | null, now: string): string {
  if (!from) return "—";
  const min = Math.max(0, Math.floor((Date.parse(now) - Date.parse(from)) / 60_000));
  if (min < 120) return `${min}m`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

/** Splits a Markdown table line into cells; `\|` stays inside a cell. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replaceAll("\\|", "|"));
}

/** Each table in `text`: first line number, column count and drawn width (3 per column + 1). */
export function tableWidths(text: string): { line: number; cols: number; width: number }[] {
  const out: { line: number; cols: number; width: number }[] = [];
  let rows: string[][] = [];
  let start = 0;
  const flush = () => {
    if (rows.length === 0) return;
    const cols = Math.max(...rows.map((r) => r.length));
    const widths = Array.from({ length: cols }, (_, i) => Math.max(...rows.map((r) => textWidth(r[i] ?? ""))));
    out.push({ line: start, cols, width: widths.reduce((a, b) => a + b, 0) + 3 * cols + 1 });
    rows = [];
  };
  [...text.split("\n"), ""].forEach((line, i) => {
    if (line.trimStart().startsWith("|")) {
      if (rows.length === 0) start = i + 1;
      if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) rows.push(cells(line));
    } else flush();
  });
  return out;
}
