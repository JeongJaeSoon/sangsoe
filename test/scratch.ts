import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made: string[] = [];
let hooked = false;

/**
 * A fresh directory under the system temporary root, removed when this test process exits. Every
 * `npm test` used to leave its per-call directories behind (about 40 a run, 13k on a busy machine).
 */
export function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  if (!hooked) {
    hooked = true;
    process.on("exit", () => {
      for (const d of made) rmSync(d, { recursive: true, force: true });
    });
  }
  return dir;
}
