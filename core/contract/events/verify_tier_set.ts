import { bool, defineEvent, oneOf, opt, prRef, sha, str, who } from "../define.ts";

const tier = oneOf("V0", "V1", "V2", "V3");

// pr-monitor is the only writer; the current tier is a view over these rows (decision 85).
export default defineEvent("verify_tier_set", {
  pr: prRef,
  head_sha: sha,
  computed: tier,
  requested: opt(tier),
  effective: tier,
  actor: who,
  accepted: bool,
  reason: str,
  owner_action_ref: opt(str),
});
