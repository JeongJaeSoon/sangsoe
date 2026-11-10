import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Host, realHost } from "../install/host.ts";
import { openPrs } from "./facts.ts";

const noStore = () => ({ events: () => [] });

type Answer = { code: number; stdout?: string; stderr?: string };

function fakeHost(answer: (cmd: string, args: readonly string[]) => Answer | undefined) {
  const calls: string[][] = [];
  const host: Host = {
    ...realHost,
    run: (cmd, args) => {
      calls.push([cmd, ...args]);
      const a = answer(cmd, args);
      return a ? { stdout: "", stderr: "", ...a } : { code: 1, stdout: "", stderr: "unexpected" };
    },
  };
  return { host, calls };
}

const NOT_FORK = { nameWithOwner: "acme/api", isFork: false, parent: null };
const listed = (...rows: [number, string][]) => JSON.stringify(rows.map(([number, login]) => ({ number, headRepositoryOwner: { login } })));

/** A checkout on feature/x whose origin is `url`; `gh` and `ssh` answer through the given functions. */
function checkout(url: string, gh: (args: readonly string[]) => Answer | undefined, ssh?: (args: readonly string[]) => Answer | undefined) {
  return fakeHost((cmd, args) => {
    if (cmd === "git" && args.includes("--show-current")) return { code: 0, stdout: "feature/x\n" };
    if (cmd === "git" && args.includes("get-url")) return { code: 0, stdout: `${url}\n` };
    if (cmd === "gh") return gh(args);
    if (cmd === "ssh") return ssh?.(args);
    return undefined;
  });
}

test("decision 198: the open PRs are read for the session's worktree, by name, never from the hook's own cwd", () => {
  const { host, calls } = checkout("git@github.com:acme/api.git", (args) =>
    args[0] === "repo" ? { code: 0, stdout: JSON.stringify(NOT_FORK) } : { code: 0, stdout: listed([7, "acme"], [8, "someone"]) },
  );
  assert.deepEqual(openPrs(host, "/work/acme/api", noStore), [{ pr: "acme/api#7", landRequested: false }], "a same-named branch of another fork is not this one");
  assert.deepEqual(calls, [
    ["git", "-C", "/work/acme/api", "branch", "--show-current"],
    ["git", "-C", "/work/acme/api", "remote", "get-url", "origin"],
    ["gh", "repo", "view", "acme/api", "--json", "nameWithOwner,isFork,parent"],
    ["gh", "pr", "list", "-R", "acme/api", "--head", "feature/x", "--state", "open", "--json", "number,headRepositoryOwner"],
  ]);
});

test("decision 201: an SSH host alias is resolved by ssh -G to the host it names", () => {
  const { host, calls } = checkout(
    "git@gh-work:Acme/api.git",
    (args) => (args[0] === "repo" ? { code: 0, stdout: JSON.stringify({ ...NOT_FORK, nameWithOwner: "Acme/api" }) } : { code: 0, stdout: listed([9, "Acme"]) }),
    () => ({ code: 0, stdout: "user git\nhostname github.com\nport 22\n" }),
  );
  assert.deepEqual(openPrs(host, "/work/acme/api", noStore), [{ pr: "acme/api#9", landRequested: false }]);
  assert.deepEqual(calls[2], ["ssh", "-G", "gh-work"]);
  assert.deepEqual(calls[3], ["gh", "repo", "view", "Acme/api", "--json", "nameWithOwner,isFork,parent"]);
});

test("decision 201: a GitHub Enterprise host is named to gh as HOST/OWNER/REPO", () => {
  for (const url of ["https://git.example.com/acme/api.git", "ssh://git@git.example.com:2222/acme/api"]) {
    const { host, calls } = checkout(
      url,
      (args) => (args[0] === "repo" ? { code: 0, stdout: JSON.stringify(NOT_FORK) } : { code: 0, stdout: listed([3, "acme"]) }),
      () => ({ code: 0, stdout: "hostname git.example.com\n" }),
    );
    assert.deepEqual(openPrs(host, "/w", noStore), [{ pr: "acme/api#3", landRequested: false }], url);
    const gh = calls.filter((c) => c[0] === "gh");
    assert.deepEqual(gh[0]?.slice(0, 4), ["gh", "repo", "view", "git.example.com/acme/api"], url);
    assert.deepEqual(gh[1]?.slice(0, 5), ["gh", "pr", "list", "-R", "git.example.com/acme/api"], url);
  }
});

test("decision 201: a fork's PRs are read on its upstream, by the fork owner's head", () => {
  const { host, calls } = checkout("git@github.com:me/api.git", (args) =>
    args[0] === "repo"
      ? { code: 0, stdout: JSON.stringify({ nameWithOwner: "me/api", isFork: true, parent: { name: "api", owner: { login: "acme" } } }) }
      : { code: 0, stdout: listed([5, "acme"], [6, "Me"]) },
  );
  const landed = () => ({ events: () => [{ payload: { pr: "acme/api#6" } }] as never });
  assert.deepEqual(openPrs(host, "/w", landed), [{ pr: "acme/api#6", landRequested: true }]);
  assert.deepEqual(calls.at(-1)?.slice(0, 5), ["gh", "pr", "list", "-R", "acme/api"]);
});

test("decision 201: what cannot be resolved or read is unknown", () => {
  const cases: [string, ReturnType<typeof fakeHost>][] = [
    ["remote not a GitHub-shaped URL", checkout("/srv/git/api.git", () => undefined)],
    ["ssh -G fails", checkout("git@gh-work:acme/api.git", () => undefined, () => ({ code: 255 }))],
    ["gh repo view fails", checkout("git@github.com:acme/api.git", () => ({ code: 1 }))],
    [
      "gh pr list fails",
      checkout("git@github.com:acme/api.git", (args) => (args[0] === "repo" ? { code: 0, stdout: JSON.stringify(NOT_FORK) } : { code: 1 })),
    ],
    ["a fork with no parent named", checkout("git@github.com:me/api.git", () => ({ code: 0, stdout: JSON.stringify({ nameWithOwner: "me/api", isFork: true, parent: null }) }))],
    [
      "detached HEAD",
      fakeHost((cmd, args) => (cmd === "git" && args.includes("--show-current") ? { code: 0, stdout: "\n" } : undefined)),
    ],
    [
      "origin unreadable for another reason",
      fakeHost((cmd, args) =>
        cmd === "git" && args.includes("--show-current") ? { code: 0, stdout: "x\n" } : { code: 128, stderr: "fatal: unsafe repository" },
      ),
    ],
  ];
  for (const [name, { host }] of cases) assert.equal(openPrs(host, "/w", noStore), undefined, name);
});

test("an empty cwd is unknown; /, a folder outside every repo and a checkout with no origin have no PR, and nothing asks GitHub", () => {
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
      assert.deepEqual(openPrs(host, cwd, noStore), cwd === "" ? undefined : [], JSON.stringify(cwd));
      assert.ok(!calls.some((c) => c[0] === "gh"), JSON.stringify(cwd));
      if (cwd === "") assert.deepEqual(calls, [], "an empty cwd runs nothing (git -C '' would read the process's cwd)");
    }
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
  const { host, calls } = fakeHost((cmd, args) =>
    cmd === "git" && args.includes("--show-current") ? { code: 0, stdout: "x\n" } : { code: 2, stderr: "error: No such remote 'origin'" },
  );
  assert.deepEqual(openPrs(host, "/w", noStore), []);
  assert.ok(!calls.some((c) => c[0] === "gh"));
});
