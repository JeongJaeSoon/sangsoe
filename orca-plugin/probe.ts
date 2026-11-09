// First-build probes T1–T4 (docs/test-outcomes.md). They run only when asked through a panel
// request or `orca plugin dev request`, never on activate, so a started worker writes nothing.
// TODO(U1): the sqlite probe gives way to the core store's start check once it lands.
// TODO(U2): the gh/orca probes give way to the core Orca and gh adapters once they land.
import { execFile } from "node:child_process";

// Decision 35: WAL-reset fix is in 3.51.3+, backported to 3.50.7+ and 3.44.6+.
export function meetsSqliteFloor(version: string): boolean {
  const [a = 0, b = 0, c = 0] = version.split(".").map((n) => Number.parseInt(n, 10));
  if (a !== 3) return a > 3;
  if (b > 51) return true;
  if (b === 51) return c >= 3;
  if (b === 50) return c >= 7;
  if (b === 44) return c >= 6;
  return false;
}

export type SqliteProbe =
  | { ok: true; node: string; sqlite: string; meetsFloor: boolean; rows: number; path: string }
  | { ok: false; node: string; error: string };

export async function probeSqlite(path: string): Promise<SqliteProbe> {
  const node = process.version;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS probe(at INTEGER NOT NULL)");
      db.prepare("INSERT INTO probe(at) VALUES (?)").run(Date.now());
      const rows = Number((db.prepare("SELECT count(*) AS n FROM probe").get() as { n: number }).n);
      const sqlite = String((db.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v);
      return { ok: true, node, sqlite, meetsFloor: meetsSqliteFloor(sqlite), rows, path };
    } finally {
      db.close();
    }
  } catch (e) {
    return { ok: false, node, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ExecProbe = { cmd: string; ok: boolean; code: string | number | null; out: string; err: string; ms: number };

// `out` is stdout alone so callers can parse it; `maxOut` caps what a report carries.
export function probeExec(cmd: string, args: readonly string[], timeoutMs = 8000, maxOut = 2000): Promise<ExecProbe> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    execFile(cmd, [...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) => {
      resolve({
        cmd: [cmd, ...args].join(" "),
        ok: !e,
        code: e ? ((e as NodeJS.ErrnoException).code ?? null) : 0,
        out: String(stdout).trim().slice(0, maxOut),
        err: String(stderr).trim().slice(0, 2000),
        ms: Date.now() - t0,
      });
    });
  });
}

export function ownKey(listJson: string): string | null {
  let parsed: { result?: { plugins?: { pluginKey: string }[] } };
  try {
    parsed = JSON.parse(listJson);
  } catch {
    return null;
  }
  const keys = (parsed.result?.plugins ?? []).map((p) => p.pluginKey).filter((k) => k.endsWith(".sangsoe"));
  return keys.length === 1 ? (keys[0] ?? null) : null;
}
