import pkg from "../package.json" with { type: "json" };

// The core, both plugins and the MCP server must report this one string (design §2 "버전 고정").
export const VERSION: string = pkg.version;
