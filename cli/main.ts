#!/usr/bin/env node
import {
  type CheckContext,
  doctor,
  type Host,
  install,
  realCheckContext,
  realHost,
  treeRoot,
  uninstall,
  VERSION,
} from "../core/index.ts";
import { pluginApprove } from "./commands/plugin-approve.ts";

const USAGE = [
  "usage: sangsoe <command>",
  "  --version            print the version",
  "  install              register this tree with Claude Code and Orca (idempotent), then run doctor",
  "  uninstall            remove those registrations; data and settings stay",
  "  doctor [--offline]   check the install; --offline checks only the installed tree",
  "  plugin approve [--dry-run] [--dir <path>] [--commit <sha>]",
  "                       check review and build, then enable the Orca plugin",
].join("\n");

export async function run(
  argv: readonly string[],
  host: Host = realHost,
  checkContext: (root: string) => CheckContext = realCheckContext,
): Promise<{ code: number; out: string }> {
  const [cmd, ...rest] = argv;
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    return { code: 0, out: `sangsoe ${VERSION}` };
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return { code: 0, out: USAGE };
  if (rest.includes("--help") || rest.includes("-h")) return { code: 0, out: USAGE };
  const flags = new Set(rest);
  const only = (...allowed: string[]) => [...flags].every((f) => allowed.includes(f));
  const done = (o: { code: number; lines: string[] }) => ({ code: o.code, out: o.lines.join("\n") });
  if (cmd === "install" && only()) {
    const root = treeRoot(host);
    return done(await install(host, root, checkContext(root)));
  }
  if (cmd === "uninstall" && only()) return done(uninstall(host));
  if (cmd === "doctor" && only("--offline")) {
    const root = treeRoot(host);
    return done(await doctor(host, root, flags.has("--offline") ? { offline: true } : { ctx: checkContext(root) }));
  }
  return { code: 2, out: USAGE };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  // TODO(U5): the command router takes this dispatch over.
  const { code, out } =
    argv[0] === "plugin" && argv[1] === "approve"
      ? await pluginApprove(argv.slice(2), (line) => process.stdout.write(`${line}\n`))
      : await run(argv);
  (code === 0 ? process.stdout : process.stderr).write(`${out}\n`);
  process.exitCode = code;
}
