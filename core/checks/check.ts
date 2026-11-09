import type { Exec, OrcaAdapter } from "../contract/orca.ts";

/** `fail` refuses the start; `warn` and `notice` print one line and let it go on. */
export type CheckStatus = "ok" | "notice" | "warn" | "fail";

export type CheckResult = {
  id: string;
  status: CheckStatus;
  summary: string;
  /** The command a person runs to fix it; set on every non-ok result. */
  fix?: string;
};

/**
 * The installed Orca plugin folder and the reviewed build it should equal (decision 105). A port,
 * because the build is a download; the start leaves it unset so it never fetches.
 */
export type PluginBuild = {
  dir: string;
  fetchBuild(): Promise<{ commit: string; dir: string; dispose(): Promise<void> } | { error: string; fix: string }>;
};

/** Host state comes in here, so tests run every check against the fake Orca. */
export type CheckContext = { orca: OrcaAdapter; exec: Exec; coreVersion: string; pluginBuild?: PluginBuild };

/**
 * The doctor check function shape. One file per check under core/checks/; a unit adding a
 * check adds its file and one line to `START_CHECKS`.
 */
export type Check = { id: string; run(ctx: CheckContext): Promise<CheckResult> };

export async function runChecks(checks: readonly Check[], ctx: CheckContext): Promise<CheckResult[]> {
  return Promise.all(
    checks.map(async (c): Promise<CheckResult> => {
      try {
        return await c.run(ctx);
      } catch (err) {
        return { id: c.id, status: "fail", summary: `점검이 예외로 끝났다: ${String(err)}`, fix: "sangsoe doctor" };
      }
    }),
  );
}

/** SessionStart: silent when all is well, one line per finding otherwise. */
export function startReport(results: readonly CheckResult[]): { refuse: boolean; lines: string[] } {
  const lines = results
    .filter((r) => r.status !== "ok")
    .map((r) => `sangsoe ${r.status}: ${r.summary}${r.fix ? ` — ${r.fix}` : ""}`);
  return { refuse: results.some((r) => r.status === "fail"), lines };
}

/** `sangsoe doctor`: every item, green or red, with its fix command. Exit 1 only when the start would be refused. */
export function doctorReport(results: readonly CheckResult[]): { exitCode: 0 | 1; lines: string[] } {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${r.status === "ok" ? "🟢" : "🔴"} ${r.id} (${r.status}): ${r.summary}`);
    if (r.fix && r.status !== "ok") lines.push(`   고칠 명령: ${r.fix}`);
  }
  return { exitCode: results.some((r) => r.status === "fail") ? 1 : 0, lines };
}
