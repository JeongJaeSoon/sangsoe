import { readdirSync } from "node:fs";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

// Same rule as cli/collect.ts: one source file per item, picked up by listing the folder at
// start-up, so a unit adds a file and edits no shared index. `.ts` is the source run under
// `node --test`; `.js` is the tsc build in dist/.
const ITEM = /^[^.]+\.(ts|js)$/;

export async function collect<T extends { name: string }>(dir: URL): Promise<Map<string, T>> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => ITEM.test(n));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw e;
  }
  const items = new Map<string, T>();
  for (const file of names.sort()) {
    const mod: { default?: T } = await import(new URL(file, dir).href);
    const item = mod.default;
    const stem = basename(file, extname(file));
    if (!item || item.name !== stem) {
      throw new Error(`${fileURLToPath(new URL(file, dir))}: default export must have name "${stem}"`);
    }
    items.set(item.name, item);
  }
  return items;
}
