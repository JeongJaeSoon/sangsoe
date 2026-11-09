import { execFile } from "node:child_process";
import type { Exec, ExecResult } from "../contract/orca.ts";

const MAX_BUFFER = 64 * 1024 * 1024;

/** Runs a command without a shell, so arguments are never re-parsed. */
export function nodeExec(timeoutMs = 60_000): Exec {
  return (file, args) =>
    new Promise<ExecResult>((resolve) => {
      execFile(file, [...args], { timeout: timeoutMs, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout, stderr });
        const e = err as NodeJS.ErrnoException & { code?: unknown; killed?: boolean };
        if (typeof e.code === "number") return resolve({ code: e.code, stdout, stderr });
        const failure = e.killed ? "timeout" : "spawn";
        resolve({ code: null, stdout, stderr: stderr || String(err.message), failure });
      });
    });
}
