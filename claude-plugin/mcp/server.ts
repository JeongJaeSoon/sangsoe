#!/usr/bin/env node
import { createInterface } from "node:readline";
import { VERSION } from "../../core/index.ts";
import { collect } from "./collect.ts";
import type { JsonSchema, Outcome, Refusal, ResourceDef, ToolDef } from "./contract.ts";

// Revisions with the initialize handshake, which carry the methods below unchanged. A client
// asking for another gets the newest of these. 2026-07-28 (server/discover, no initialize) is
// not served until Claude Code asks for it.
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

type Id = string | number;
type Request = { jsonrpc: "2.0"; id?: Id; method: string; params?: Record<string, unknown> };
type Response = { jsonrpc: "2.0"; id: Id | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
);

export type Server = {
  tools: ReadonlyMap<string, ToolDef>;
  /** One parsed JSON-RPC message in; the response, or undefined for a notification. */
  handle(msg: unknown): Promise<Response | undefined>;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function asRequest(m: unknown): Request | undefined {
  if (!isObject(m) || m.jsonrpc !== "2.0" || typeof m.method !== "string") return undefined;
  if ("id" in m && typeof m.id !== "string" && typeof m.id !== "number") return undefined;
  if ("params" in m && !isObject(m.params)) return undefined;
  return m as Request;
}

export async function createServer(
  dirs: { tools?: URL; resources?: URL } = {},
): Promise<Server> {
  const tools = await collect<ToolDef>(dirs.tools ?? new URL("./tools/", import.meta.url));
  const resources = await collect<ResourceDef>(dirs.resources ?? new URL("./resources/", import.meta.url));
  const fixed = [...resources.values()].filter((r) => "uri" in r);
  const templated = [...resources.values()].filter((r) => "uriTemplate" in r);

  const methods: Record<string, (p: Record<string, unknown>) => unknown> = {
    initialize: (p) => {
      const client = p.clientInfo;
      const clientOk = isObject(client) && typeof client.name === "string" && typeof client.version === "string";
      if (typeof p.protocolVersion !== "string" || !isObject(p.capabilities) || !clientOk) {
        throw new RpcError(-32602, "initialize needs protocolVersion, capabilities and clientInfo");
      }
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "sangsoe", version: VERSION },
      };
    },
    ping: () => ({}),
    "tools/list": () => ({
      tools: [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }),
    "tools/call": async (p) => {
      if (typeof p.name !== "string") throw new RpcError(-32602, "tools/call needs a string name");
      const tool = tools.get(p.name);
      if (!tool) throw new RpcError(-32602, `Unknown tool: ${String(p.name)}`);
      const input = p.arguments ?? {};
      if (!isObject(input)) {
        const fix = `call ${tool.name} with an object of arguments`;
        return toCallResult({ ok: false, refusal: { code: "invalid_input", reason: "arguments must be an object", fix } });
      }
      const bad = checkInput(tool, input);
      return toCallResult(bad ? { ok: false, refusal: bad } : await tool.handler(input));
    },
    "resources/list": () => ({
      resources: fixed.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })),
    }),
    "resources/templates/list": () => ({
      resourceTemplates: templated.map(({ uriTemplate, name, description, mimeType }) => ({ uriTemplate, name, description, mimeType })),
    }),
    "resources/read": async (p) => {
      const uri = p.uri;
      if (typeof uri !== "string") throw new RpcError(-32602, "resources/read needs a string uri");
      const res = fixed.find((r) => r.uri === uri);
      if (res) return { contents: [{ uri, mimeType: res.mimeType, text: await res.read() }] };
      for (const t of templated) {
        const vars = matchTemplate(t.uriTemplate, uri);
        if (vars) return { contents: [{ uri, mimeType: t.mimeType, text: await t.read(vars) }] };
      }
      throw new RpcError(-32002, `Resource not found: ${uri}`);
    },
  };

  return {
    tools,
    async handle(raw) {
      const msg = asRequest(raw);
      if (!msg) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
      const method = Object.hasOwn(methods, msg.method) ? methods[msg.method] : undefined;
      if (msg.id === undefined) return undefined;
      if (!method) return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
      try {
        return { jsonrpc: "2.0", id: msg.id, result: await method(msg.params ?? {}) };
      } catch (e) {
        const code = e instanceof RpcError ? e.code : -32603;
        const message = e instanceof Error ? e.message : describe(e);
        return { jsonrpc: "2.0", id: msg.id, error: { code, message } };
      }
    },
  };
}

// String() itself throws on some values (Object.create(null)); the loop must still answer.
function describe(thrown: unknown): string {
  try {
    return String(thrown);
  } catch {
    return "internal error";
  }
}

function matchTemplate(template: string, uri: string): Record<string, string> | undefined {
  const names: string[] = [];
  const source = template
    .split(/(\{[a-z_]+\})/)
    .map((part) => {
      const name = /^\{([a-z_]+)\}$/.exec(part)?.[1];
      if (!name) return part.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
      names.push(name);
      return "([^/?#]+)";
    })
    .join("");
  const m = new RegExp(`^${source}$`).exec(uri);
  if (!m) return undefined;
  try {
    return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1] ?? "")]));
  } catch {
    return undefined;
  }
}

class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

// The text is the JSON of the value or of the refusal, so an agent and
// expectSameViaBothEntrances read the same thing the CLI prints under --json.
function toCallResult(o: Outcome) {
  return o.ok
    ? { content: [{ type: "text", text: JSON.stringify(o.value) }], isError: false }
    : { content: [{ type: "text", text: JSON.stringify(o.refusal) }], isError: true };
}

const TYPE_OK: Record<NonNullable<JsonSchema["type"]>, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number",
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: Array.isArray,
};

// ponytail: top-level keys only (required, unknown, type, enum); nested schemas are the
// core function's to check until a tool needs more.
function checkInput(tool: ToolDef, input: Record<string, unknown>): Refusal | undefined {
  const { properties = {}, required = [], additionalProperties } = tool.inputSchema;
  const fix = `call ${tool.name} with ${JSON.stringify(Object.keys(properties))} (required: ${JSON.stringify(required)})`;
  const refuse = (reason: string): Refusal => ({ code: "invalid_input", reason, fix });
  for (const key of required) if (!(key in input)) return refuse(`missing required argument "${key}"`);
  for (const [key, value] of Object.entries(input)) {
    const prop = properties[key];
    if (!prop) {
      if (additionalProperties === false) return refuse(`unknown argument "${key}"`);
      continue;
    }
    if (prop.type && !TYPE_OK[prop.type](value)) return refuse(`argument "${key}" must be ${prop.type}`);
    if (prop.enum && !prop.enum.includes(value)) return refuse(`argument "${key}" must be one of ${JSON.stringify(prop.enum)}`);
  }
  return undefined;
}

export async function serveStdio(server: Server): Promise<void> {
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      continue;
    }
    const res = await server.handle(msg);
    if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
  }
}

if (import.meta.main) await serveStdio(await createServer());
