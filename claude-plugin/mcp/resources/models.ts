import {
  MODEL_CATALOG,
  MODEL_CHANGELOG,
  MODEL_POLICY,
  MODEL_SOURCES,
  MODEL_STALE_DAYS,
  VERIFIED_WITH_CLAUDE_CODE,
} from "../../../core/index.ts";
import type { ResourceDef } from "../contract.ts";

export default {
  name: "models",
  uri: "sangsoe://models",
  description:
    "sangsoe's one model-selection table (decision 164): the catalog (tier, alias, current ID, role, price, source, verified date, pin) and the policy (kind of work -> tier, effort, effort ladder, next tier, trigger, cited guide line). start_unit's kind/effort/tier/reason pick from it.",
  mimeType: "application/json",
  read: async () =>
    JSON.stringify(
      {
        catalog: MODEL_CATALOG,
        policy: MODEL_POLICY,
        changelog: MODEL_CHANGELOG,
        sources: MODEL_SOURCES,
        staleDays: MODEL_STALE_DAYS,
        verifiedWithClaudeCode: VERIFIED_WITH_CLAUDE_CODE,
      },
      null,
      2,
    ),
} satisfies ResourceDef;
