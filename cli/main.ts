#!/usr/bin/env node
import { VERSION } from "../core/index.ts";

export function run(argv: readonly string[]): { code: number; out: string } {
  const [cmd] = argv;
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    return { code: 0, out: `sangsoe ${VERSION}` };
  }
  return { code: 2, out: "usage: sangsoe --version" };
}

if (import.meta.main) {
  const { code, out } = run(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(`${out}\n`);
  process.exitCode = code;
}
