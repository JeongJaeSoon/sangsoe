// The only module other slots may import from the core; see docs/architecture.md.
export { VERSION } from "./version.ts";
export { type ApprovePorts, type ApproveResult, approvePlugin } from "./approve/approve.ts";
export { nodePorts, resolveCommit } from "./approve/ports.ts";
