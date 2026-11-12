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

/**
 * Decision 228: the tail of doctor's `permissions` warn row. A full row needs no tail: sangsoe's
 * own MCP server rule already lets land through.
 */
export function landAllowClause(a: LandAllow | undefined): string {
  if (!a || a.permissions.length + a.autoMode.length === 0) return ", and auto mode may refuse a worker's land";
  return `; sangsoe land is allowed (permissions.allow ${a.permissions.length}, autoMode.allow ${a.autoMode.length})`;
}
