import { cp, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * The folder's `contentHash` from Orca's `orca plugin inspect`, without the `.orca/` folder Orca
 * itself writes there (`orca plugin dev load` refreshes its typings; Orca skips it when loading),
 * which inspect still counts. Every content comparison goes through here: approve's and doctor's,
 * for the installed folder and for the fetched trees alike (decision 258).
 */
export async function inspectContentHash(dir: string, inspect: (dir: string) => Promise<string | null>): Promise<string | null> {
  // The copy is taken from where a linked folder leads: a copied link would resolve from the copy.
  const real = await realpath(dir).catch(() => null);
  if (real === null) return inspect(dir);
  const own = join(real, ".orca");
  const isDir = await lstat(own).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!isDir) return inspect(dir);
  const root = await mkdtemp(join(tmpdir(), "sangsoe-hash-"));
  try {
    const copy = join(root, basename(real));
    // A link inside would resolve from the copy too, and the tree has none: such a folder, or one
    // that cannot be copied, cannot be hashed, and the callers fail closed on null.
    let linked = false;
    const filter = async (src: string) => {
      if (src === own) return false;
      if ((await lstat(src)).isSymbolicLink()) linked = true;
      return !linked;
    };
    const copied = await cp(real, copy, { recursive: true, filter }).then(
      () => true,
      () => false,
    );
    return copied && !linked ? await inspect(copy) : null;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
