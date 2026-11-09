import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statfsSync } from "node:fs";
import { dirname } from "node:path";

// Start checks for the store (decision 35, split U1 (3)). doctor (U2) calls the same functions and
// only prints them differently.

export interface StartCheck {
  readonly name: "sqlite_version" | "db_filesystem";
  readonly ok: boolean;
  readonly detail: string;
  readonly fix?: string;
}

// WAL-reset corruption exists in 3.7.0–3.51.2; fixed in 3.51.3 and backported to 3.50.7 and 3.44.6.
export function sqliteVersionOk(version: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const [maj, min, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (maj !== 3) return maj > 3;
  if (min > 51) return true;
  if (min === 51) return patch >= 3;
  if (min === 50) return patch >= 7;
  if (min === 44) return patch >= 6;
  return false;
}

export function checkSqliteVersion(version: string): StartCheck {
  const ok = sqliteVersionOk(version);
  return {
    name: "sqlite_version",
    ok,
    detail: `SQLite ${version}${ok ? "" : " is below 3.51.3 (or 3.50.7 / 3.44.6): WAL-reset corruption bug"}`,
    ...(ok ? {} : { fix: "upgrade Node to a release bundling SQLite >= 3.51.3 (Node >= 24.15)" }),
  };
}

/** Returns the filesystem type name of the volume holding `path`, lower-case; host state, injected in tests. */
export type FsProbe = (dir: string) => string;

export const NETWORK_FS: ReadonlySet<string> = new Set([
  "nfs",
  "nfs4",
  "smbfs",
  "smb",
  "smb2",
  "cifs",
  "afpfs",
  "webdav",
  "9p",
  "afs",
  "coda",
  "ncpfs",
]);

// Filesystems known to be local. Anything else, including a network one, is refused.
export const LOCAL_FS: ReadonlySet<string> = new Set([
  "apfs",
  "hfs",
  "ext4",
  "xfs",
  "btrfs",
  "tmpfs",
  "overlay",
  "zfs",
  "f2fs",
]);

// statfs f_type magic numbers (linux/magic.h); ext2/3/4 share one.
const LINUX_MAGIC: ReadonlyMap<number, string> = new Map([
  [0xef53, "ext4"],
  [0x58465342, "xfs"],
  [0x9123683e, "btrfs"],
  [0x01021994, "tmpfs"],
  [0x794c7630, "overlay"],
  [0x2fc12fc1, "zfs"],
  [0xf2f52010, "f2fs"],
  [0x6969, "nfs"],
  [0x517b, "smb"],
  [0xfe534d42, "smb2"],
  [0xff534d42, "cifs"],
  [0x01021997, "9p"],
]);

function nearestExisting(path: string): string {
  let p = path;
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  return realpathSync(p);
}

export const defaultFsProbe: FsProbe = (path) => {
  const at = nearestExisting(path);
  if (process.platform === "linux") {
    const type = statfsSync(at).type;
    return LINUX_MAGIC.get(type) ?? `unknown:0x${type.toString(16)}`;
  }
  if (process.platform === "darwin") {
    const out = execFileSync("/sbin/mount", { encoding: "utf8" });
    let best = { point: "", type: "unknown" };
    for (const line of out.split("\n")) {
      const m = / on (.+) \(([^,)]+)/.exec(line);
      if (!m?.[1] || !m[2]) continue;
      const point = m[1];
      const inside = at === point || at.startsWith(point.endsWith("/") ? point : `${point}/`);
      if (inside && point.length >= best.point.length) best = { point, type: m[2].toLowerCase() };
    }
    return best.type;
  }
  return "unknown";
};

// Only a filesystem known to be local passes: the store does not open where it cannot tell.
// `path` is the database file (or where it will be); an existing symlink is followed.
export function checkLocalFs(path: string, probe: FsProbe = defaultFsProbe): StartCheck {
  let type: string;
  try {
    type = probe(path);
  } catch (e) {
    return { name: "db_filesystem", ok: false, detail: `cannot read the filesystem of ${path}: ${String(e)}` };
  }
  const ok = LOCAL_FS.has(type);
  return {
    name: "db_filesystem",
    ok,
    detail: `${path} is on ${type}${ok ? "" : NETWORK_FS.has(type) ? ": a network filesystem" : ": not known to be local"}`,
    ...(ok ? {} : { fix: "keep the database on a local disk (default ~/.local/share/sangsoe/)" }),
  };
}
