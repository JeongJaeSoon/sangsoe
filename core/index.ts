// The only module other slots may import from the core; see docs/architecture.md.
export { doctor } from "./install/doctor.ts";
export { type Host, realHost, treeRoot } from "./install/host.ts";
export { install, type Outcome, uninstall } from "./install/install.ts";
export { VERSION } from "./version.ts";
export { type ApprovePorts, type ApproveResult, approvePlugin } from "./approve/approve.ts";
export { nodePorts, resolveCommit } from "./approve/ports.ts";
