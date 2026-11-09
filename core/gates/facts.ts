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

const PR_URL = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;

/** Open PRs from the worktree's branch, each with whether `land_requested` names it. undefined when unread. */
export function openPrs(host: Host, cwd: string, store: () => Pick<Store, "events"> | undefined): OpenPr[] | undefined {
  const branch = host.run("git", ["-C", cwd, "branch", "--show-current"]);
  const name = branch.stdout.trim();
  if (branch.code !== 0 || name === "") return undefined;
  const list = host.run("gh", ["pr", "list", "--head", name, "--state", "open", "--json", "url"]);
  if (list.code !== 0) return undefined;
  let prs: string[];
  try {
    prs = (JSON.parse(list.stdout) as { url: string }[]).flatMap((p) => {
      const m = PR_URL.exec(p.url);
      return m ? [`${m[1]?.toLowerCase()}#${m[2]}`] : [];
    });
  } catch {
    return undefined;
  }
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
    readScript: (path) => {
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
