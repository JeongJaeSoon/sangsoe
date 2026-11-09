/** The cells of every table body row in a markdown file (header and separator rows left out). */
export function tableRows(md: string): string[][] {
  const rows: string[][] = [];
  let header = false;
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) {
      header = false;
      continue;
    }
    if (/^\|[-|]+\|$/.test(line)) continue;
    if (!header) {
      header = true;
      continue;
    }
    rows.push(line.slice(1, -1).split(" | ").map((c) => c.trim()));
  }
  return rows;
}

export const ticks = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
