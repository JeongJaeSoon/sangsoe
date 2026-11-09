import assert from "node:assert/strict";
import type { Outcome } from "../../claude-plugin/mcp/contract.ts";
import { createServer } from "../../claude-plugin/mcp/server.ts";
import { run } from "../../cli/main.ts";

// One core function, called through the MCP tool and the CLI command that wrap it, must give
// the same Outcome (design §3 #boundaries, R-16). Each side is decoded from its own wire form:
// the tools/call text and isError, and the CLI's --json output and exit code.

export type Entrances = { tools?: URL; commands?: URL };

export async function viaMcp(tool: string, input: Record<string, unknown>, dirs: Entrances = {}): Promise<Outcome> {
  const server = await createServer(dirs.tools ? { tools: dirs.tools } : {});
  const res = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: input } });
  assert.ok(res && "result" in res, `tools/call ${tool} failed at the protocol level: ${JSON.stringify(res)}`);
  const { content, isError } = res.result as { content: { type: string; text: string }[]; isError: boolean };
  const parsed = JSON.parse(content[0]?.text ?? "");
  return isError ? { ok: false, refusal: parsed } : { ok: true, value: parsed };
}

export async function viaCli(argv: readonly string[], dirs: Entrances = {}): Promise<Outcome> {
  const { code, out } = await run([...argv, "--json"], dirs.commands ? { commands: dirs.commands } : {});
  const parsed = JSON.parse(out);
  return code === 0 ? { ok: true, value: parsed } : { ok: false, refusal: parsed };
}

/** Calls `tool` with `input` and the CLI with `argv`; fails unless both Outcomes are equal. Returns that Outcome. */
export async function expectSameViaBothEntrances(call: {
  tool: string;
  input: Record<string, unknown>;
  argv: readonly string[];
  dirs?: Entrances;
}): Promise<Outcome> {
  const mcp = await viaMcp(call.tool, call.input, call.dirs);
  const cli = await viaCli(call.argv, call.dirs);
  assert.deepEqual(cli, mcp, `${call.tool} via MCP and \`sangsoe ${call.argv.join(" ")}\` differ`);
  return mcp;
}
