import type { Exec, OrcaAdapter, WorktreeRow } from "../contract/orca.ts";
import { type Check, inside } from "./checks.ts";
import type { DockerState } from "./docker.ts";

/**
 * Decision 194 ③: a listener Orca ties to the card (by process cwd or command line, so no terminal
 * needs to be open). REAPER does no port probing of its own and never stops the process.
 */
export async function listening(card: Pick<WorktreeRow, "id">, orca: Pick<OrcaAdapter, "ports">): Promise<Check> {
  const r = await orca.ports({ worktree: `id:${card.id}` });
  if (!r.ok) return { ok: false, unknown: `ports: ${r.error.code}` };
  return r.value.length > 0 ? { ok: false, blocked: "listener" } : { ok: true };
}

export type Stacks =
  | { kind: "no_docker" }
  | { kind: "unanswered"; why: string }
  | { kind: "unread"; why: string }
  | { kind: "read"; running: string[][] };

/** Compose projects with a live service (running, restarting or paused), each as its absolute config file paths. */
export async function readStacks(exec: Exec, docker: () => Promise<DockerState>): Promise<Stacks> {
  const s = await docker();
  if (s.kind === "absent") return { kind: "no_docker" };
  if (s.kind === "unanswered") return s;
  const r = await exec("docker", ["compose", "ls", "--all", "--format", "json"]);
  if (r.code !== 0) return { kind: "unread", why: "docker compose ls failed" };
  let rows: unknown;
  try {
    rows = JSON.parse(r.stdout);
  } catch {
    return { kind: "unread", why: "docker compose ls: not JSON" };
  }
  if (!Array.isArray(rows)) return { kind: "unread", why: "docker compose ls: not a list" };
  const running = (rows as { Status?: unknown; ConfigFiles?: unknown }[])
    // `running(2)`, or mixed: `running(1), exited(1)`.
    .filter((s) => /running|restarting|paused/.test(String(s.Status ?? "")))
    .map((s) =>
      String(s.ConfigFiles ?? "")
        .split(",")
        .map((f) => f.trim())
        .filter((f) => f !== ""),
    );
  return { kind: "read", running };
}

/**
 * Decision 194 ④: a running stack whose config file sits in the card. Without a `docker` binary there
 * is no stack to lose (decision 82 R6); a Docker that does not answer blocks (decision 201). REAPER
 * never calls `down`.
 */
export function composeRunning(card: Pick<WorktreeRow, "path">, stacks: Stacks): Check {
  if (stacks.kind === "no_docker") return { ok: true };
  if (stacks.kind === "unanswered") return { ok: false, blocked: "docker_unreachable" };
  if (stacks.kind === "unread") return { ok: false, unknown: stacks.why };
  return stacks.running.some((files) => files.some((f) => inside(card.path, f))) ? { ok: false, blocked: "compose_running" } : { ok: true };
}
