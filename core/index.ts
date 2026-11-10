// The only module other slots may import from the core; see docs/architecture.md.
export * from "./contract/index.ts";
export * from "./store/checks.ts";
export {
  evaluate,
  GATES,
  type HookInput,
  hookOutput,
  type Merged as GateMerged,
  mergeVerdicts,
  parseHookInput,
  roleOf,
  START_TOOL_ID,
} from "./gates/index.ts";
export type { Facts as GateFacts, Gate, Verdict as GateVerdict, Role as SessionRole } from "./gates/types.ts";
export { firstPrompt, hostFacts, openPrs } from "./gates/facts.ts";
export { deniedDir, recordDenial } from "./gates/record.ts";
export { type ReplayCounts, type ReplayRow, replay } from "./gates/replay.ts";
export * from "./store/store.ts";
export { decision } from "./store/views/decision.ts";
export { item_timeline } from "./store/views/item_timeline.ts";
export { doctor, realCheckContext } from "./install/doctor.ts";
export { type Host, realHost, treeRoot } from "./install/host.ts";
export { install, type Outcome, uninstall } from "./install/install.ts";
export { stageCore, unstageCore } from "./install/stage.ts";
export { VERSION } from "./version.ts";
export {
  type Exec as ApproveExec,
  type ApprovePorts,
  type ApproveResult,
  approvePlugin,
  type PluginApproved,
  SANGSOE_REPO,
} from "./approve/approve.ts";
export { nodeExec as approveExec, isCheckout, nodePorts, resolveCommit } from "./approve/ports.ts";
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

export * from "./session/index.ts";

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
export * from "./graph/index.ts";
export * from "./brief/index.ts";
// Both declare the same four-kind union; GRAPH's is the source.
export type { EdgeKind } from "./graph/index.ts";

export {
  type Act,
  DEFAULT_MONITOR_CONFIG,
  isMonitorName,
  MONITOR_NAMES,
  type MonitorConfig,
  type MonitorDeps,
  type MonitorName,
  type MonitorReport,
  type Planned,
  type Reading,
} from "./detect/monitor.ts";
export { MONITORS, type MonitorRunner, openMonitors, runMonitor } from "./detect/run.ts";
export { orchestratorRun, type RunAbove, runAbove, sendNotice } from "./detect/notice.ts";
export { judgeOrca, type OrcaReads, type SessionActivity, sessionActivity } from "./detect/orca/judge.ts";
export { judgeResource, type ResourceReads, withDiagnostics } from "./detect/resource/judge.ts";
export { type ChatProvider, nullChatProvider } from "./detect/chat/provider.ts";
export { parseWatch, readWatchConfig, type WatchConfig } from "./detect/pr/config.ts";
export { classifyMain, type MainRun, type MainVerdict } from "./detect/pr/judge.ts";
export { linkOf, type LinkedTask, prRound } from "./detect/pr/round.ts";
export { judgeQueue, type Moot, QUEUE_SOURCE, type QueueJudgment, type ReadyItem, type Reanswer, type StaleAnswer } from "./detect/queue/judge.ts";
export { judgeDrift } from "./detect/queue/drift.ts";
export { judgeStall, STALL_SOURCE } from "./detect/queue/stall.ts";
export { QUEUE_CALLER, queueRound, type StallReport, stallCheck } from "./detect/queue/round.ts";
export { orcaPluginDrift, type PluginDrift } from "./checks/orca-plugin-version.ts";

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
export {
  EVIDENCE_KINDS,
  type EvidenceRecordInput,
  type RecordPorts,
  type RecordResult,
  recordEvidence,
  recordStage,
  STAGES,
  type StageRecordInput,
} from "./land/record.ts";
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

export { applyImport, type ImportResult } from "./migrate/apply.ts";
export {
  DONE_WHEN as IMPORT_DONE_WHEN,
  decisionSubject as importDecisionSubject,
  type ImportCounts,
  type ImportExtra,
  type Imported,
  type ImportPlan,
  importedFrom,
  NOTHING_IMPORTED,
  type PlannedDecision,
  type PlannedEdge,
  type PlannedItem,
  planImport,
} from "./migrate/plan.ts";
export { defaultOldStorePath, type OldDecision, type OldItem, type OldState, readOldState } from "./migrate/source.ts";

export {
  type Check,
  type CheckContext,
  type CheckResult,
  type CheckStatus,
  DOCTOR_CHECKS,
  doctorReport,
  modelTable,
  type PluginBuild,
  REQUIRED_CAPABILITIES,
  runChecks,
  START_CHECKS,
  startReport,
} from "./checks/index.ts";

export * from "./owner/index.ts";
export * from "./reaper/index.ts";

export {
  type Alias as ModelAlias,
  CATALOG as MODEL_CATALOG,
  CHANGELOG as MODEL_CHANGELOG,
  type Choice as ModelChoice,
  catalogAgeDays,
  EFFORTS,
  type Effort,
  isEffort,
  isKind as isModelKind,
  KINDS as MODEL_KINDS,
  type Kind as ModelKind,
  POLICY as MODEL_POLICY,
  type Raise as ModelRaise,
  resolve as resolveModel,
  SOURCES as MODEL_SOURCES,
  STALE_DAYS as MODEL_STALE_DAYS,
  TIERS as MODEL_TIERS,
  type Tier as ModelTier,
  VERIFIED_WITH_CLAUDE_CODE,
} from "./models/index.ts";
