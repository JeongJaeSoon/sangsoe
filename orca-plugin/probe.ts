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

export type ExecProbe = { cmd: string; ok: boolean; code: string | number | null; out: string; ms: number };

// `maxOut` caps what a report carries; callers that parse the output pass Infinity.
export function probeExec(cmd: string, args: readonly string[], timeoutMs = 8000, maxOut = 2000): Promise<ExecProbe> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    execFile(cmd, [...args], { timeout: timeoutMs }, (err, stdout, stderr) => {
      const text = `${stdout}${stderr}`.trim();
      resolve({
        cmd: [cmd, ...args].join(" "),
        ok: !err,
        code: err ? ((err as NodeJS.ErrnoException).code ?? null) : 0,
        out: text.slice(0, maxOut),
        ms: Date.now() - t0,
      });
    });
  });
}

// T1's "core runs in the worker": a dev-loaded folder may reach outside itself; an installed copy
// may not, which is what tells U4 whether the worker must be bundled with the core.
export async function probeCore(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const core = (await import("../core/index.ts")) as { VERSION: string };
    return { ok: true, version: core.VERSION };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
