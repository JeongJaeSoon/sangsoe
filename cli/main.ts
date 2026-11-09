#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type CheckContext, type Host, realCheckContext, realHost } from "../core/index.ts";
import type { CommandDef, Outcome, Refusal, Report } from "./contract.ts";

export type Result = { code: number; out: string };

// Exit codes: 0 done, 1 refused by the core (a Refusal) or a failing Report, 2 usage error (nothing ran).
const USAGE = "usage: sangsoe <command> [args] [--json]";

// Same rule as claude-plugin/mcp/collect.ts: one file per command, found by listing the
// folder, so a unit adds commands/<name>.ts and never edits this router.
const ITEM = /^[^.]+\.(ts|js)$/;

export async function collectCommands(dir: URL): Promise<Map<string, CommandDef>> {
  const commands = new Map<string, CommandDef>();
  for (const file of readdirSync(dir).filter((n) => ITEM.test(n)).sort()) {
    const cmd: CommandDef | undefined = (await import(new URL(file, dir).href)).default;
    const stem = basename(file, extname(file));
    if (!cmd || cmd.name.replaceAll(" ", "-") !== stem) {
      throw new Error(`${fileURLToPath(new URL(file, dir))}: default export must have name "${stem.replaceAll("-", " ")}"`);
    }
    commands.set(cmd.name, cmd);
  }
  return commands;
}

export async function run(
  argv: readonly string[],
  opts: { commands?: URL; host?: Host; checkContext?: (root: string) => CheckContext } = {},
): Promise<Result> {
  const commands = await collectCommands(opts.commands ?? new URL("./commands/", import.meta.url));
  const json = argv.includes("--json");
  const args = argv.filter((a) => a !== "--json");
  const [first, second] = args;

  if (first === undefined) return { code: 2, out: `${USAGE}\nrun sangsoe --help for the commands` };
  if (first === "--help" || first === "-h" || first === "help") return { code: 0, out: help(commands) };

  const name = first === "--version" || first === "-v" ? "version" : first;
  const cmd = commands.get(`${name} ${second}`) ?? commands.get(name);
  if (!cmd) return { code: 2, out: `${USAGE}\nunknown command "${first}"; run sangsoe --help for the commands` };

  const rest = args.slice(cmd.name.split(" ").length);
  const form = `usage: sangsoe ${cmd.name}${cmd.usage ? ` ${cmd.usage}` : ""}`;
  if (rest.includes("--help") || rest.includes("-h")) return { code: 0, out: `${form}\n${cmd.summary}` };

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: rest, options: cmd.options ?? {}, allowPositionals: true, strict: true });
    if (parsed.positionals.length > (cmd.maxPositionals ?? 0)) {
      throw new Error(`unexpected argument "${parsed.positionals[cmd.maxPositionals ?? 0]}"`);
    }
  } catch (e) {
    const refusal: Refusal = { code: "invalid_input", reason: (e as Error).message, fix: form };
    return { code: 2, out: json ? JSON.stringify(refusal) : `${form}\n${refusal.reason}` };
  }

  const host = opts.host ?? realHost;
  const checkContext = opts.checkContext ?? realCheckContext;
  return render(cmd, await cmd.run({ values: parsed.values, positionals: parsed.positionals, host, checkContext }), json);
}

function render(cmd: CommandDef, o: Outcome | Report, json: boolean): Result {
  if ("lines" in o) return { code: o.code, out: json ? JSON.stringify(o.lines) : o.lines.join("\n") };
  if (o.ok) {
    const text = json || typeof o.value !== "string" ? JSON.stringify(o.value) : o.value;
    return { code: 0, out: text };
  }
  const { code, reason, fix } = o.refusal;
  return { code: 1, out: json ? JSON.stringify(o.refusal) : `sangsoe ${cmd.name}: ${reason} [${code}]\nfix: ${fix}` };
}

function help(commands: ReadonlyMap<string, CommandDef>): string {
  const width = Math.max(0, ...[...commands.keys()].map((n) => n.length));
  const rows = [...commands.values()].map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`);
  return [USAGE, "", "commands:", ...rows, "", "sangsoe <command> --help shows one command's arguments."].join("\n");
}

if (import.meta.main) {
  const { code, out } = await run(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(`${out}\n`);
  process.exitCode = code;
}
