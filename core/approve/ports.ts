import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stageCore } from "../install/stage.ts";
import { Store } from "../store/store.ts";
import type { ApprovePorts, Exec } from "./approve.ts";
import { reviewEvidenceFrom } from "./review-verdict.ts";

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

export function nodePorts(write: (line: string) => void, openStore: () => Store = () => Store.open()): ApprovePorts {
  return {
    exec: nodeExec,
    async fetchPluginTree(repo, commit, staged) {
      const root = await mkdtemp(join(tmpdir(), "sangsoe-approve-"));
      const dispose = () => rm(root, { recursive: true, force: true });
      try {
        await writeFile(join(root, "tree.tgz"), await execBytes("gh", ["api", `repos/${repo}/tarball/${commit}`]));
        const tar = await nodeExec("tar", ["-xzf", join(root, "tree.tgz"), "-C", root]);
        if (tar.code !== 0) throw new Error(`tar: ${tar.stderr.trim()}`);
        const tops = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory());
        if (tops.length !== 1 || !tops[0]) throw new Error("unexpected tarball layout");
        if (staged) await stageCore(join(root, tops[0].name));
        return { dir: join(root, tops[0].name, "orca-plugin"), dispose };
      } catch (e) {
        await dispose();
        throw e;
      }
    },
    // A store that cannot be opened gives no evidence: condition (1) fails closed.
    async reviewEvidence(repo, pr, headSha) {
      let store: Store;
      try {
        store = openStore();
      } catch (e) {
        write(`store: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
      try {
        return reviewEvidenceFrom(store.events({ type: "review_verdict" }), repo, pr, headSha);
      } finally {
        store.close();
      }
    },
    async openLedger() {
      const store = openStore();
      return {
        async record({ type, ...payload }) {
          const out = store.append({ type, source: "plugin approve", payload });
          write(`recorded ${type} (seq ${out.seq})`);
        },
        close: () => store.close(),
      };
    },
    async readManifest(dir) {
      return JSON.parse(await readFile(join(dir, "orca-plugin.json"), "utf8"));
    },
    now: () => Date.now(),
  };
}

// The commit a plugin folder was built from: the HEAD of a clean git checkout that tracks the
// folder, else the `build-info.json` the release build writes beside it (outside it, so the
// content hash Orca computes for the folder stays the reviewed tree's). A git repo that merely
// contains the folder (Homebrew's prefix ignores its Cellar) says nothing about the build.
export async function resolveCommit(dir: string, exec: Exec = nodeExec): Promise<string | null> {
  if (await isCheckout(dir, exec)) {
    const dirty = await exec("git", ["-C", dir, "status", "--porcelain", "--", "."]);
    if (dirty.code !== 0 || dirty.stdout.trim() !== "") return null;
    const head = await exec("git", ["-C", dir, "rev-parse", "HEAD"]);
    return head.code === 0 ? head.stdout.trim() : null;
  }
  try {
    const info = JSON.parse(await readFile(join(dirname(dir), "build-info.json"), "utf8")) as { commit?: unknown } | null;
    return typeof info?.commit === "string" ? info.commit : null;
  } catch {
    return null;
  }
}

/** A git checkout that tracks the folder: Orca loads it as the git tree, with no staged core (decision 152). */
export async function isCheckout(dir: string, exec: Exec = nodeExec): Promise<boolean> {
  return (await exec("git", ["-C", dir, "ls-files", "--error-unmatch", "--", "orca-plugin.json"])).code === 0;
}
