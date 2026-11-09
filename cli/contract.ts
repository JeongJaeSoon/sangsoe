import type { ParseArgsOptionsConfig } from "node:util";
import type { Host } from "../core/index.ts";

// Refusal and Outcome mirror claude-plugin/mcp/contract.ts (the two slots do not import each
// other); test/boundaries/contract.test.ts fails if they drift apart.

export type Refusal = { code: string; reason: string; fix: string };

export type Outcome<T = unknown> = { ok: true; value: T } | { ok: false; refusal: Refusal };

/** What a command that reports to a person (install, doctor) returns: exit code and lines. */
export type Report = { code: number; lines: string[] };

export type CommandArgs = {
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  positionals: string[];
  /** The machine the command may touch; tests pass a fake (R-11). */
  host: Host;
};

export type CommandDef = {
  /** One or two words; spaces become hyphens in the file name: "plugin approve" is commands/plugin-approve.ts. */
  name: string;
  /** One line for `sangsoe --help`. */
  summary: string;
  /** Arguments after the name, e.g. "<pr> [--wait-minutes N]"; shown on --help and on a usage error. */
  usage: string;
  /** Parsed strictly by the router: an option not listed here is a usage error and run() is never called. */
  options?: ParseArgsOptionsConfig;
  /** Options that must be given; a missing one is a usage error and run() is never called. */
  required?: readonly string[];
  /** Upper bound on positionals; default 0. */
  maxPositionals?: number;
  run(args: CommandArgs): Outcome | Report | Promise<Outcome | Report>;
};
