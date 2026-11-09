import { checkSqliteVersion } from "../store/checks.ts";
import type { Check } from "./check.ts";

const id = "sqlite-version";

// The same floor `Store.open` refuses on, read from the SQLite this Node bundles.
export const sqliteVersion: Check = {
  id,
  async run(ctx) {
    const r = checkSqliteVersion(ctx.sqliteVersion ?? process.versions.sqlite ?? "unknown");
    return r.ok ? { id, status: "ok", summary: r.detail } : { id, status: "fail", summary: r.detail, fix: r.fix ?? "brew upgrade node" };
  },
};
