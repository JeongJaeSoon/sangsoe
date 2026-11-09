import { arr, bool, defineEvent, oneOf, opt, orcaId, priority, str, who } from "../define.ts";

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
  done_when: opt(str),
  verify: opt(oneOf("pr_merged", "orca_field", "plugin_approved", "run_ok", "pr_found")),
  cmd_hint: opt(str),
  why_owner: opt(str),
  links: opt(arr(str)),
});
