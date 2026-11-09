import type { Exec } from "../contract/orca.ts";

export const DOCKER_KINDS = ["container", "volume", "network", "image"] as const;
export type DockerKind = (typeof DOCKER_KINDS)[number];
export const isDockerKind = (k: string): k is DockerKind => (DOCKER_KINDS as readonly string[]).includes(k);

export type DockerRef = { kind: DockerKind; ref: string };
export type DockerOutcome = { kind: DockerKind; ref: string; result: "removed" | "gone" | "in_use" };

/** Whether `docker` has a daemon to answer; with none the Docker step is skipped (decision 82 R6). */
export async function dockerUp(exec: Exec): Promise<boolean> {
  const r = await exec("docker", ["version", "--format", "{{.Server.Version}}"]);
  return r.code === 0 && r.stdout.trim() !== "";
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
        out.push({ kind, ref, result: "gone" });
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
