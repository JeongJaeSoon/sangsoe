import { closeSync, openSync, readSync, statSync } from "node:fs";
import { judgeLoad, sampleLoad } from "../capacity/capacity.ts";
import type { Host } from "../install/host.ts";
import type { Store } from "../store/store.ts";
import { type HookInput, roleOf } from "./index.ts";
import type { Facts, OpenPr, Role } from "./types.ts";

const HEAD_BYTES = 64 * 1024;
const SCRIPT_BYTES = 64 * 1024;

function head(path: string, bytes: number): string | undefined {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(bytes);
      return buf.toString("utf8", 0, readSync(fd, buf, 0, bytes, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/** The text of the transcript's first user message. */
export function firstPrompt(transcriptPath: string | undefined): string | undefined {
  if (!transcriptPath) return undefined;
  for (const line of (head(transcriptPath, HEAD_BYTES) ?? "").split("\n")) {
    try {
      const rec = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
      if (rec.type !== "user") continue;
      const c = rec.message?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n");
      return undefined;
    } catch {
      // A partial last line or a non-JSON line is skipped.
    }
  }
  return undefined;
}

// `https://host/o/r`, `ssh://user@host:port/o/r` or scp-like `user@host:o/r`, each with an optional `.git`.
const URL_REMOTE = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;
const SCP_REMOTE = /^(?:[^@/]+@)?([^/:]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

const parse = <T>(text: string): T | undefined => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};

/**
 * The repository `gh` names for origin, as `[HOST/]OWNER/REPO`. An SSH host may be an alias from the
 * ssh config, so `ssh -G` (which reads the config and connects to nothing) names the real host.
 */
function ghRepo(host: Host, url: string): string | undefined {
  const m = URL_REMOTE.exec(url) ?? SCP_REMOTE.exec(url);
  if (!m) return undefined;
  let at = m[1]?.toLowerCase() ?? "";
  if (!/^https?:/.test(url) && at !== "github.com") {
    const g = host.run("ssh", ["-G", at]);
    at = g.code === 0 ? (/^hostname (\S+)$/m.exec(g.stdout)?.[1]?.toLowerCase() ?? "") : "";
    if (!at) return undefined;
  }
  return at === "github.com" ? `${m[2]}/${m[3]}` : `${at}/${m[2]}/${m[3]}`;
}

type RepoView = { nameWithOwner?: string; isFork?: boolean; parent?: { name?: string; owner?: { login?: string } } | null };

/**
 * Open PRs from the worktree's branch, each with whether `land_requested` names it. `[]` when no PR can
 * exist (not a checkout, no origin); undefined when unread, which the gate refuses (decision 201).
 */
// Decision 198: both reads name the session's worktree; `gh` would otherwise pick the repo from the hook
// process's own cwd. An empty cwd (`git -C ""` reads the process's) is unknown.
export function openPrs(host: Host, cwd: string, store: () => Pick<Store, "events"> | undefined): OpenPr[] | undefined {
  if (!cwd) return undefined;
  const branch = host.run("git", ["-C", cwd, "branch", "--show-current"]);
  if (branch.code !== 0) return /not a git repository/i.test(branch.stderr) ? [] : undefined;
  const name = branch.stdout.trim();
  if (name === "") return undefined;
  const remote = host.run("git", ["-C", cwd, "remote", "get-url", "origin"]);
  if (remote.code !== 0) return /no such remote/i.test(remote.stderr) ? [] : undefined;
  const repo = ghRepo(host, remote.stdout.trim());
  if (!repo) return undefined;
  const view = host.run("gh", ["repo", "view", repo, "--json", "nameWithOwner,isFork,parent"]);
  const v = view.code === 0 ? parse<RepoView>(view.stdout) : undefined;
  const own = v?.nameWithOwner?.split("/")[0]?.toLowerCase();
  if (!v || !own) return undefined;
  // A fork's PRs are opened on its upstream.
  const up = v.isFork ? (v.parent?.owner?.login && v.parent.name ? `${v.parent.owner.login}/${v.parent.name}` : undefined) : v.nameWithOwner;
  if (!up) return undefined;
  const at = repo.split("/").length === 3 ? `${repo.split("/")[0]}/${up}` : up;
  const list = host.run("gh", ["pr", "list", "-R", at, "--head", name, "--state", "open", "--json", "number,headRepositoryOwner"]);
  const rows = list.code === 0 ? parse<{ number?: number; headRepositoryOwner?: { login?: string } }[]>(list.stdout) : undefined;
  if (!Array.isArray(rows)) return undefined;
  // `--head` takes a bare branch name, so another fork's branch of the same name is listed too.
  const prs = rows.filter((p) => p.headRepositoryOwner?.login?.toLowerCase() === own && Number.isInteger(p.number)).map((p) => `${up.toLowerCase()}#${p.number}`);
  if (prs.length === 0) return [];
  try {
    const s = store();
    if (!s) return undefined;
    const landed = new Set(s.events({ type: "land_requested" }).map((e) => String((e.payload as { pr?: string }).pr)));
    return prs.map((pr) => ({ pr, landRequested: landed.has(pr) }));
  } catch {
    // An unreadable store is an unread fact, not a reason to fail every Bash call.
    return undefined;
  }
}

/** The facts as this machine has them; each read once per hook process, and only when asked. */
export function hostFacts(input: HookInput, host: Host, store: () => Pick<Store, "events"> | undefined): Facts {
  const once = <T>(f: () => T) => {
    let done = false;
    let v: T;
    return () => {
      if (!done) {
        v = f();
        done = true;
      }
      return v;
    };
  };
  return {
    role: once((): Role => roleOf(input.agent_type, () => firstPrompt(input.transcript_path))),
    load: once(() => judgeLoad(sampleLoad(host.env.HOME))),
    ownOpenPrs: once(() => openPrs(host, input.cwd, store)),
    readScript: (named) => {
      const home = host.env.HOME;
      const path = home ? named.replace(/^(~|\$HOME|\$\{HOME\})\//, `${home}/`) : named;
      try {
        // isFile: a FIFO or device named as a script would block the hook on read.
        const st = statSync(path);
        return st.isFile() && st.size <= SCRIPT_BYTES ? host.readText(path) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
