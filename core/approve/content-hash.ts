import { cp, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * The folder's `contentHash` from Orca's `orca plugin inspect`, without the `.orca/` folder Orca
 * itself writes there (`orca plugin dev load` refreshes its typings; Orca skips it when loading),
 * which inspect still counts. Every content comparison goes through here: approve's and doctor's,
 * for the installed folder and for the fetched trees alike (decision 258).
 */
export async function inspectContentHash(dir: string, inspect: (dir: string) => Promise<string | null>): Promise<string | null> {
  const own = join(dir, ".orca");
  const isDir = await lstat(own).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDir) return inspect(dir);
  const root = await mkdtemp(join(tmpdir(), "sangsoe-hash-"));
  try {
    const copy = join(root, basename(dir));
    // A folder that cannot be copied is one that cannot be inspected: the callers fail closed on null.
    const copied = await cp(dir, copy, { recursive: true, verbatimSymlinks: true, filter: (src) => src !== own }).then(
      () => true,
      () => false,
    );
    return copied ? await inspect(copy) : null;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
