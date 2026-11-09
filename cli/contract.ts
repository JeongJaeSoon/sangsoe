import type { ParseArgsOptionsConfig } from "node:util";

// Refusal and Outcome mirror claude-plugin/mcp/contract.ts (the two slots do not import each
// other); test/boundaries/contract.test.ts fails if they drift apart.

export type Refusal = { code: string; reason: string; fix: string };

export type Outcome<T = unknown> = { ok: true; value: T } | { ok: false; refusal: Refusal };

export type CommandArgs = {
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  positionals: string[];
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
  /** Upper bound on positionals; default 0. */
  maxPositionals?: number;
  run(args: CommandArgs): Outcome | Promise<Outcome>;
};
