import { arr, bool, defineEvent, match, oneOf, opt, orcaId, priority, str, verifySpec, who } from "../define.ts";

// Extra facts keyed by an Orca task id; the item_extra view folds the latest of each field.
export default defineEvent("item_extra_set", {
  task: orcaId,
  exec_by: opt(oneOf("owner", "lead", "worker")),
  lead: opt(who),
  priority: opt(priority),
  est: opt(str),
  trigger: opt(str),
  review_trigger: opt(str),
  hold: opt(bool),
  waits_on: opt(oneOf("owner", "reviewer", "infra", "lead", "worker")),
  flow: opt(str),
  step: opt(str),
  /** The release stage a flow step stands for; a deploys_after edge from it needs stage_recorded at this stage. */
  stage: opt(oneOf("merge", "dev", "prod")),
  done_when: opt(str),
  verify: opt(verifySpec),
  cmd_hint: opt(str),
  why_owner: opt(str),
  links: opt(arr(str)),
  /** The worker unit's class from item_create; start_unit reads it when given no class or kind (decision 187). */
  unit_class: opt(oneOf("default", "hard", "design", "mechanical", "docs")),
  /** The Orca repo selector start_unit passes as `worker-start --repo` for this item (decision 197). */
  repo: opt(match(/^(id|name|path):\S/, "Orca repo selector id:|name:|path:")),
});
