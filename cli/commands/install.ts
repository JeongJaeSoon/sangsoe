import { createInterface } from "node:readline/promises";
import { install, installPermissions, type Scope, SCOPES, staleSessions, treeRoot } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

async function askOnTerminal(text: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(text)).trim());
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

export default {
  name: "install",
  summary: "register this tree with Claude Code and Orca (idempotent), then run doctor; --permissions adds the allow rules sangsoe's sessions need",
  usage: "[--permissions [--scope user|project|local] [--yes]] | --stale-sessions",
  options: { permissions: { type: "boolean" }, scope: { type: "string" }, yes: { type: "boolean" }, "stale-sessions": { type: "boolean" } },
  run: ({ values, host, checkContext }) => {
    if (values["stale-sessions"] === true) {
      if (values.permissions !== undefined || values.scope !== undefined || values.yes !== undefined) {
        return { ok: false, refusal: { code: "invalid_input", reason: "--stale-sessions only lists, so it takes no other flag", fix: "sangsoe install --stale-sessions" } };
      }
      return { code: 0, lines: staleSessions(host) };
    }
    if (values.permissions !== true) {
      if (values.scope !== undefined || values.yes !== undefined) {
        return { ok: false, refusal: { code: "invalid_input", reason: "--scope and --yes go with --permissions", fix: "sangsoe install --permissions --scope user" } };
      }
      const root = treeRoot(host);
      return install(host, root, checkContext(root));
    }
    const scope = (values.scope ?? "user") as Scope;
    if (!SCOPES.includes(scope)) {
      return { ok: false, refusal: { code: "invalid_input", reason: `--scope must be one of ${SCOPES.join(", ")}`, fix: "sangsoe install --permissions --scope user" } };
    }
    return installPermissions(host, {
      scope,
      cwd: process.cwd(),
      yes: values.yes === true,
      ...(process.stdin.isTTY ? { ask: askOnTerminal } : {}),
    });
  },
} satisfies CommandDef;
