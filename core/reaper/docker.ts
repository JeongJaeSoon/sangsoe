import type { Exec } from "../contract/orca.ts";

export const DOCKER_KINDS = ["container", "volume", "network", "image"] as const;
export type DockerKind = (typeof DOCKER_KINDS)[number];
export const isDockerKind = (k: string): k is DockerKind => (DOCKER_KINDS as readonly string[]).includes(k);

export type DockerRef = { kind: DockerKind; ref: string };
export type DockerOutcome = { kind: DockerKind; ref: string; result: "removed" | "gone" | "in_use" | "unknown" };

export type DockerState = { kind: "up" } | { kind: "absent" } | { kind: "unanswered"; why: string };

/**
 * Decision 201: only a missing `docker` binary (spawn ENOENT) means there is nothing to lose and the
 * Docker steps are skipped (decision 82 R6). Any other failure is a Docker that may still run stacks.
 */
export async function dockerState(exec: Exec): Promise<DockerState> {
  const r = await exec("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (r.code === 0 && r.stdout.trim() !== "") return { kind: "up" };
  if (r.failure === "spawn" && /\bENOENT\b/.test(r.stderr)) return { kind: "absent" };
  const why = r.failure === "timeout" ? "timed out" : r.failure === "spawn" ? r.stderr.trim() : r.code === 0 ? "no server version" : `exit ${r.code}`;
  return { kind: "unanswered", why: `docker version: ${why}` };
}

/**
 * Removes recorded ids one at a time, stopped containers → volumes → networks → images, never with
 * `-f`, `prune`, `down -v` or a label or name filter. A running container, and any id Docker
 * refuses to remove (a volume or network in use, an image other images build on), stays as in_use.
 */
export async function sweepDocker(exec: Exec, refs: readonly DockerRef[]): Promise<DockerOutcome[]> {
  const out: DockerOutcome[] = [];
  for (const kind of DOCKER_KINDS) {
    for (const { ref } of refs.filter((r) => r.kind === kind)) {
      const args = kind === "container" ? ["--format", "{{.State.Running}}", ref] : [ref];
      const seen = await exec("docker", [kind, "inspect", ...args]);
      if (seen.code !== 0) {
        // Only Docker's own not-found answer closes the record; a timeout or daemon error is asked again.
        out.push({ kind, ref, result: /no such/i.test(seen.stderr) ? "gone" : "unknown" });
        continue;
      }
      if (kind === "container" && seen.stdout.trim() !== "false") {
        out.push({ kind, ref, result: "in_use" });
        continue;
      }
      const rm = await exec("docker", [kind, "rm", ref]);
      out.push({ kind, ref, result: rm.code === 0 ? "removed" : "in_use" });
    }
  }
  return out;
}
