// Decision 152: a release carries the core the Orca worker runs inside the plugin folder, so the
// folder's content hash (what approve and doctor compare) covers it. The pack step and the reviewed
// tree fetched by approve and doctor run this same function, so both sides hash the same bytes.
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

/** Inside `orca-plugin/`; core/version.ts reads `../package.json`, so the copy sits one level down. */
export const STAGED_DIR = "vendor";

export async function stageCore(treeRoot: string): Promise<void> {
  const into = join(treeRoot, "orca-plugin", STAGED_DIR);
  await rm(into, { recursive: true, force: true });
  await cp(join(treeRoot, "core"), join(into, "core"), { recursive: true, filter: (src) => !src.endsWith(".test.ts") });
  await cp(join(treeRoot, "package.json"), join(into, "package.json"));
}

export async function unstageCore(treeRoot: string): Promise<void> {
  await rm(join(treeRoot, "orca-plugin", STAGED_DIR), { recursive: true, force: true });
}
