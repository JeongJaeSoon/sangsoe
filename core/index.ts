// The only module other slots may import from the core; see docs/architecture.md.
export * from "./contract/index.ts";
export * from "./store/checks.ts";
export * from "./store/store.ts";
export { decision } from "./store/views/decision.ts";
export { item_timeline } from "./store/views/item_timeline.ts";
export { doctor } from "./install/doctor.ts";
export { type Host, realHost, treeRoot } from "./install/host.ts";
export { install, type Outcome, uninstall } from "./install/install.ts";
export { VERSION } from "./version.ts";
export { type ApprovePorts, type ApproveResult, approvePlugin } from "./approve/approve.ts";
export { nodePorts, resolveCommit } from "./approve/ports.ts";

export type { CoreDeps, Refusal, Result } from "./notify/result.ts";
export { reportAddress } from "./notify/address.ts";
export { type Chain, type Notified, type NotifyInput, notify, type Tier, TIERS } from "./notify/notify.ts";
export { decisionKey } from "./decision/key.ts";
export { type DecisionOpened, type DecisionOpenInput, decisionOpen } from "./decision/open.ts";
export { type DecisionAnswered, type DecisionAnswerInput, decisionAnswer } from "./decision/answer.ts";
export { type DecisionMooted, type DecisionMootInput, decisionMoot, type MootEvidence } from "./decision/moot.ts";
export { waiterReading } from "./decision/held.ts";
export { defaultDeps } from "./decision/deps.ts";
export { decisionAnswerFrom, decisionOpenFrom, parseDecisionAnswer, parseDecisionOpen } from "./decision/input.ts";

export type * from "./contract/orca.ts";
export { createOrcaAdapter, recoverWrite } from "./orca/adapter.ts";
export { type CommandName, type CommandSpec, ORCA_COMMANDS } from "./orca/commands.ts";
export { nodeExec } from "./orca/exec.ts";
export { isLocalHost, keepLocal, LOCAL_HOST } from "./orca/host-filter.ts";

export {
  budgetLevel,
  createGhClient,
  type GhCache,
  type GhClient,
  type GhResponse,
  memoryGhCache,
  type RateBudget,
} from "./gh/client.ts";
export {
  type MergeCondition,
  type MergeConditionId,
  type MergeConditions,
  matchesPath,
  readMergeConditions,
} from "./gh/merge-conditions.ts";

export {
  type Check,
  type CheckContext,
  type CheckResult,
  type CheckStatus,
  doctorReport,
  REQUIRED_CAPABILITIES,
  runChecks,
  START_CHECKS,
  startReport,
} from "./checks/index.ts";
