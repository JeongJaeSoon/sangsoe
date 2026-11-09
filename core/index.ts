// The only module other slots may import from the core; see docs/architecture.md.
export * from "./contract/index.ts";
export * from "./store/checks.ts";
export * from "./store/store.ts";
export { decision } from "./store/views/decision.ts";
export { item_timeline } from "./store/views/item_timeline.ts";
export { doctor, realCheckContext } from "./install/doctor.ts";
export { type Host, realHost, treeRoot } from "./install/host.ts";
export { install, type Outcome, uninstall } from "./install/install.ts";
export { VERSION } from "./version.ts";
export {
  type Exec as ApproveExec,
  type ApprovePorts,
  type ApproveResult,
  approvePlugin,
  type PluginApproved,
  SANGSOE_REPO,
} from "./approve/approve.ts";
export { nodeExec as approveExec, nodePorts, resolveCommit } from "./approve/ports.ts";
export { recordReviewVerdict, reviewEvidenceFrom } from "./approve/review-verdict.ts";

export type { CoreDeps, Refusal, Result } from "./notify/result.ts";
export { reportAddress } from "./notify/address.ts";
export { type Chain, type Notified, type NotifyInput, notify, type Tier, TIERS } from "./notify/notify.ts";
export { decisionKey } from "./decision/key.ts";
export { type DecisionOpened, type DecisionOpenInput, decisionOpen } from "./decision/open.ts";
export { type DecisionAnswered, type DecisionAnswerInput, decisionAnswer } from "./decision/answer.ts";
export { type DecisionMooted, type DecisionMootInput, decisionMoot, type MootEvidence } from "./decision/moot.ts";
export { waiterReading } from "./decision/held.ts";
export { defaultDeps } from "./decision/deps.ts";
export {
  decisionAnswerFrom,
  decisionMootFrom,
  decisionOpenFrom,
  parseDecisionAnswer,
  parseDecisionMoot,
  parseDecisionOpen,
} from "./decision/input.ts";

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

export * from "./start/index.ts";
export {
  capacity,
  DEFAULT_THRESHOLDS,
  judgeLoad,
  type LoadLevel,
  type LoadSample,
  type LoadThresholds,
  type LoadVerdict,
  sampleLoad,
} from "./capacity/capacity.ts";
export { type RecoverPlan, type RecoverRow, recoverPlan, renderRecover } from "./recover/recover.ts";

export {
  type LandAction,
  type LandConfig,
  type LandDeps,
  type LandInput,
  type LandOutcome,
  type LandStore,
  type LandValue,
  land,
  type MergePort,
} from "./land/land.ts";
export { mergeConfirm } from "./land/github.ts";
export { ghMerge, readLandConfig, realLandDeps } from "./land/ports.ts";
export { type TierOfPr, tierOfPr } from "./land/tier.ts";
export { type EvidenceGap, evidenceGaps, mergedItemMark } from "./verify/evidence.ts";
export {
  type DiffFile,
  parseTierConfig,
  requiredEvidence,
  type Tier as VerifyTier,
  type TierConfig,
  type TierLabel,
  type TierVerdict,
  verifyTier,
} from "./verify/verify-tier.ts";

export {
  type Check,
  type CheckContext,
  type CheckResult,
  type CheckStatus,
  DOCTOR_CHECKS,
  doctorReport,
  type PluginBuild,
  REQUIRED_CAPABILITIES,
  runChecks,
  START_CHECKS,
  startReport,
} from "./checks/index.ts";
