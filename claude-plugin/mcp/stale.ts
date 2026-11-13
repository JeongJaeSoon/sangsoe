import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { VERSION } from "../../core/index.ts";

const SERVER_ENTRY = /\/claude-plugin\/mcp\/server\.[jt]s$/;

// Decision 233: a reload keeps a plugin MCP server whose configuration is unchanged, and an upgrade
// at the same install path changes none of it, so only a new session starts the new server.
export const STALE_FIX =
  "/reload-plugins does not restart this server: quit this Claude Code session, run `claude --continue` in the same directory, then call start_unit again";

/**
 * Why this MCP server is stale, or null (decision 211). A server keeps the code it loaded at start
 * while an upgrade swaps the install under it, and `/reload-plugins` does not restart it. Only when
 * server.js is the process entry: `entry` is then the path the plugin launched, read again here
 * through its symlinks, so it names what is installed now.
 */
export function staleServer(entry: string | undefined = process.argv[1], loaded: string = VERSION): string | null {
  if (!entry || !SERVER_ENTRY.test(entry)) return null;
  let installed: unknown;
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(entry), "../../package.json"), "utf8"));
    installed = pkg.name === "sangsoe" ? pkg.version : undefined;
  } catch {
    installed = undefined;
  }
  if (installed === loaded) return null;
  const now = typeof installed === "string" ? `sangsoe ${installed} is installed` : "the install it started from is gone";
  return `this MCP server runs sangsoe ${loaded}, but ${now}`;
}
