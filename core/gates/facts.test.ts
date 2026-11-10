import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Host, realHost } from "../install/host.ts";
import { openPrs } from "./facts.ts";

const noStore = () => ({ events: () => [] });

function fakeHost(answer: (cmd: string, args: readonly string[]) => { code: number; stdout: string } | undefined) {
  const calls: string[][] = [];
  const host: Host = {
    ...realHost,
    run: (cmd, args) => {
      calls.push([cmd, ...args]);
      const a = answer(cmd, args);
      return a ? { ...a, stderr: "" } : { code: 1, stdout: "", stderr: "unexpected" };
    },
  };
  return { host, calls };
}

test("decision 198: the open PRs are read for the session's worktree, by name, never from the hook's own cwd", () => {
  const { host, calls } = fakeHost((cmd, args) => {
    if (cmd === "git" && args.includes("--show-current")) return { code: 0, stdout: "feature/x\n" };
    if (cmd === "git" && args.includes("get-url")) return { code: 0, stdout: "git@github.com:acme/api.git\n" };
    if (cmd === "gh") return { code: 0, stdout: JSON.stringify([{ url: "https://github.com/acme/api/pull/7" }]) };
    return undefined;
  });
  assert.deepEqual(openPrs(host, "/work/acme/api", noStore), [{ pr: "acme/api#7", landRequested: false }]);
  assert.deepEqual(calls, [
    ["git", "-C", "/work/acme/api", "branch", "--show-current"],
    ["git", "-C", "/work/acme/api", "remote", "get-url", "origin"],
    ["gh", "pr", "list", "-R", "acme/api", "--head", "feature/x", "--state", "open", "--json", "url"],
  ]);
});

test("an empty cwd, / and a folder outside every repo are unknown, and nothing asks GitHub", () => {
  const plain = mkdtempSync(join(tmpdir(), "sangsoe-facts-"));
  try {
    for (const cwd of ["", "/", plain]) {
      const calls: string[][] = [];
      const host: Host = {
        ...realHost,
        run: (cmd, args, env) => {
          calls.push([cmd, ...args]);
          return realHost.run(cmd, args, env);
        },
      };
      assert.equal(openPrs(host, cwd, noStore), undefined, JSON.stringify(cwd));
      assert.ok(!calls.some((c) => c[0] === "gh"), JSON.stringify(cwd));
      if (cwd === "") assert.deepEqual(calls, [], "an empty cwd runs nothing (git -C '' would read the process's cwd)");
    }
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});
