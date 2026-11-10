// The second half of `npm run build` (decision 152's head note): tsc emits only .js, so every other
// file the built code opens by a path beside its module (the flow templates) is copied into dist/
// at the same relative path.
import { cpSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// The folders whose code runs from dist/: the CLI, the core it imports and the MCP server.
const RUNS_FROM_DIST = ["core", "cli", join("claude-plugin", "mcp")];

function copyAssets(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) copyAssets(p);
    else if (!e.name.endsWith(".ts") && e.name !== "README.md") cpSync(p, join(root, "dist", relative(root, p)));
  }
}

for (const r of RUNS_FROM_DIST) copyAssets(join(root, r));
