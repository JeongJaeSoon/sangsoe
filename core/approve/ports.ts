import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ApprovePorts, Exec } from "./approve.ts";

export const nodeExec: Exec = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, [...args], { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

function execBytes(cmd: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(cmd, [...args], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

export function nodePorts(write: (line: string) => void): ApprovePorts {
  return {
    exec: nodeExec,
    async fetchPluginTree(repo, commit) {
      const root = await mkdtemp(join(tmpdir(), "sangsoe-approve-"));
      const dispose = () => rm(root, { recursive: true, force: true });
      try {
        await writeFile(join(root, "tree.tgz"), await execBytes("gh", ["api", `repos/${repo}/tarball/${commit}`]));
        const tar = await nodeExec("tar", ["-xzf", join(root, "tree.tgz"), "-C", root]);
        if (tar.code !== 0) throw new Error(`tar: ${tar.stderr.trim()}`);
        const tops = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory());
        if (tops.length !== 1 || !tops[0]) throw new Error("unexpected tarball layout");
        return { dir: join(root, tops[0].name, "orca-plugin"), dispose };
      } catch (e) {
        await dispose();
        throw e;
      }
    },
    // TODO(U1): read the review evidence event; until the store lands condition 1 fails closed.
    reviewEvidence: async () => null,
    // TODO(U1): append to the event table; until then the event is printed for the caller's record.
    async record(event) {
      write(JSON.stringify(event));
    },
    async readManifest(dir) {
      return JSON.parse(await readFile(join(dir, "orca-plugin.json"), "utf8"));
    },
    now: () => Date.now(),
  };
}

// The commit a plugin folder was built from: the `build-info.json` the release build writes beside
// the folder (outside it, so the content hash Orca computes for the folder stays the reviewed
// tree's), else the HEAD of a clean git checkout that tracks the folder. A git repo that merely
// contains the folder (Homebrew's prefix ignores its Cellar) says nothing about the build.
export async function resolveCommit(dir: string, exec: Exec = nodeExec): Promise<string | null> {
  const info = join(dirname(dir), "build-info.json");
  if (existsSync(info)) {
    const commit = (JSON.parse(await readFile(info, "utf8")) as { commit?: unknown }).commit;
    return typeof commit === "string" ? commit : null;
  }
  const tracked = await exec("git", ["-C", dir, "ls-files", "--error-unmatch", "--", "orca-plugin.json"]);
  if (tracked.code !== 0) return null;
  const dirty = await exec("git", ["-C", dir, "status", "--porcelain", "--", "."]);
  if (dirty.code !== 0 || dirty.stdout.trim() !== "") return null;
  const head = await exec("git", ["-C", dir, "rev-parse", "HEAD"]);
  return head.code === 0 ? head.stdout.trim() : null;
}
