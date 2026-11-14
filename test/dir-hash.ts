import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A stand-in for `orca plugin inspect`'s contentHash: every file on disk under `dir`, dot folders
 * included, the way Orca counts `.orca/`. Null when the folder is not there.
 */
export function diskHash(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(`${relative(dir, p)}\0`).update(e.isSymbolicLink() ? `-> ${readlinkSync(p)}` : readFileSync(p));
    }
  };
  walk(dir);
  return `sha256-${h.digest("hex")}`;
}
