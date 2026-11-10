// Decision 198 (P2): auto mode refused a worker's `sangsoe land`, so the merge bridge stopped for a
// person. Adding an allow rule is the owner's act; doctor only reads whether one exists. Both places
// a rule can live are read, for both forms of the act: the Bash command and the MCP `land` tool.

const MCP_LAND = "mcp__plugin_sangsoe_sangsoe__land";
const BASH_RULE = /^Bash\(\s*sangsoe(?:\s+land\b.*|\s*:\*|\s*\*)\s*\)$/;
const MCP_RULE = new Set([MCP_LAND, "mcp__plugin_sangsoe_sangsoe", "mcp__plugin_sangsoe_sangsoe__*"]);

export type LandAllow = { permissions: string[]; autoMode: string[] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The allow rules in one settings.json that let `sangsoe land` through; empty lists when there are none. */
export function landAllowRules(settings: unknown): LandAllow {
  const s = (typeof settings === "object" && settings !== null ? settings : {}) as Record<string, Record<string, unknown> | undefined>;
  return {
    permissions: strings(s.permissions?.allow).filter((r) => BASH_RULE.test(r.trim()) || MCP_RULE.has(r.trim())),
    autoMode: strings(s.autoMode?.allow).filter((r) => /\bsangsoe land\b/.test(r) || r.includes(MCP_LAND)),
  };
}

/** One doctor line's detail: where a rule was found, or that none was. */
export function landAllowDetail(dir: string, a: LandAllow | undefined): { found: boolean; detail: string } {
  if (!a) return { found: false, detail: `${dir}/settings.json is missing or not JSON: no allow rule for sangsoe land read` };
  const n = a.permissions.length + a.autoMode.length;
  if (n === 0) return { found: false, detail: `${dir}/settings.json has no allow rule for sangsoe land (permissions.allow, autoMode.allow)` };
  return { found: true, detail: `${dir}/settings.json allows sangsoe land: permissions.allow ${a.permissions.length}, autoMode.allow ${a.autoMode.length}` };
}
