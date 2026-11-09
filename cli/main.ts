#!/usr/bin/env node
import { VERSION } from "../core/index.ts";
import { pluginApprove } from "./commands/plugin-approve.ts";

export function run(argv: readonly string[]): { code: number; out: string } {
  const [cmd] = argv;
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    return { code: 0, out: `sangsoe ${VERSION}` };
  }
  return { code: 2, out: "usage: sangsoe --version | sangsoe plugin approve [--dry-run]" };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  // TODO(U5): the command router takes this dispatch over.
  const { code, out } =
    argv[0] === "plugin" && argv[1] === "approve"
      ? await pluginApprove(argv.slice(2), (line) => process.stdout.write(`${line}\n`))
      : run(argv);
  (code === 0 ? process.stdout : process.stderr).write(`${out}\n`);
  process.exitCode = code;
}
