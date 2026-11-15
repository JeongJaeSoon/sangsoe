import { installedTree, SERVER_ENTRY, VERSION } from "../../core/index.ts";

// Decision 233: a reload keeps a plugin MCP server whose configuration is unchanged, and an upgrade
// at the same install path changes none of it, so only a new session starts the new server.
export const STALE_FIX =
  "/reload-plugins does not restart this server: quit this Claude Code session, start it again in the same directory with `claude --continue` plus the flags it was started with (such as --agent), then call start_unit again";

/**
 * Why this MCP server is stale, or null (decision 211). A server keeps the code it loaded at start
 * while an upgrade swaps the install under it, and `/reload-plugins` does not restart it. Only when
 * server.js is the process entry: `entry` is then the path the plugin launched, read again here
 * through its symlinks, so it names what is installed now.
 */
export function staleServer(entry: string | undefined = process.argv[1], loaded: string = VERSION): string | null {
  if (!entry || !SERVER_ENTRY.test(entry)) return null;
  const installed = installedTree(entry)?.version;
  if (installed === loaded) return null;
  const now = installed !== undefined ? `sangsoe ${installed} is installed` : "the install it started from is gone";
  return `this MCP server runs sangsoe ${loaded}, but ${now}`;
}
