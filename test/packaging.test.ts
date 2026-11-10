import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// F1 (stable review 2026-11-11): tsc emits no .toml, so the packed dist/ had no flow templates and
// `graph expand` failed on every installed release. This test builds and packs the real tree.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// The folders whose code runs from dist/: the CLI, the core it imports and the MCP server.
const RUNS_FROM_DIST = ["core", "cli", join("claude-plugin", "mcp")];

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", env });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};

/**
 * Files the built code can open by a path next to its module: anything tracked the compiler does not
 * emit. Listed from git, not by scripts/copy-assets.ts's walk, so the two can disagree.
 */
function sourceAssets(): string[] {
  return run("git", ["ls-files", "--", ...RUNS_FROM_DIST])
    .split("\n")
    .filter((p) => p !== "" && !p.endsWith(".ts") && basename(p) !== "README.md")
    .sort();
}

test("the flow templates are runtime assets the walk finds", () => {
  const assets = sourceAssets();
  for (const f of ["ship-change", "ship-batch"]) assert.ok(assets.includes(join("core", "graph", "flows", `${f}.toml`)), f);
});

test("the packed tree carries every runtime asset under dist/ and expands both bundled flows", { timeout: 300_000 }, () => {
  const scratch = mkdtempSync(join(tmpdir(), "sangsoe-pack-"));
  try {
    // A copy left by an earlier build must not pass for one this build made.
    for (const a of sourceAssets()) rmSync(join(ROOT, "dist", a), { force: true });
    run("npm", ["run", "build"]);
    // --ignore-scripts: prepack would stage orca-plugin/vendor/ in the checkout while other tests run.
    const packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch])) as {
      filename: string;
      files: { path: string }[];
    }[];
    const listed = new Set(packed[0]?.files.map((f) => f.path));
    const missing = sourceAssets().filter((a) => !listed.has(join("dist", a)));
    assert.deepEqual(missing, [], "runtime assets missing from the packed dist/");

    run("tar", ["-xzf", join(scratch, packed[0]?.filename ?? ""), "-C", scratch]);
    const home = join(scratch, "home");
    mkdirSync(home);
    const env = { ...process.env, HOME: home, SANGSOE_ROOT: join(scratch, "package") };
    const main = join(scratch, "package", "dist", "cli", "main.js");
    const cases: [string, string[], number][] = [
      ["ship-change", ["--var", "repo=acme/api"], 6],
      ["ship-batch", ["--var", "repo=acme/api", "--var", "members=i001"], 3],
    ];
    for (const [template, vars, steps] of cases) {
      const plan = JSON.parse(run(process.execPath, [main, "graph", "expand", "--template", template, ...vars, "--dry-run"], env)) as {
        flow: string;
        steps: unknown[];
      };
      assert.deepEqual([plan.flow, plan.steps.length], [template, steps]);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
