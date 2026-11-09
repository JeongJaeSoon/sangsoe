#!/usr/bin/env node
import { doctor, type Host, install, realHost, treeRoot, uninstall, VERSION } from "../core/index.ts";

const USAGE = [
  "usage: sangsoe <command>",
  "  --version            print the version",
  "  install              register this tree with Claude Code and Orca (idempotent), then run doctor",
  "  uninstall            remove those registrations; data and settings stay",
  "  doctor [--offline]   check the install; --offline checks only the installed tree",
].join("\n");

export function run(argv: readonly string[], host: Host = realHost): { code: number; out: string } {
  const [cmd, ...rest] = argv;
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    return { code: 0, out: `sangsoe ${VERSION}` };
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return { code: 0, out: USAGE };
  if (rest.includes("--help") || rest.includes("-h")) return { code: 0, out: USAGE };
  const flags = new Set(rest);
  const only = (...allowed: string[]) => [...flags].every((f) => allowed.includes(f));
  const done = (o: { code: number; lines: string[] }) => ({ code: o.code, out: o.lines.join("\n") });
  if (cmd === "install" && only()) return done(install(host, treeRoot(host)));
  if (cmd === "uninstall" && only()) return done(uninstall(host));
  if (cmd === "doctor" && only("--offline")) {
    return done(doctor(host, treeRoot(host), { offline: flags.has("--offline") }));
  }
  return { code: 2, out: USAGE };
}

if (import.meta.main) {
  const { code, out } = run(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(`${out}\n`);
  process.exitCode = code;
}
