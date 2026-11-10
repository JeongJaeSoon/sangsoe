import { tierSource } from "../land/land.ts";
import { readLandConfig } from "../land/ports.ts";
import type { Check } from "./check.ts";

const id = "tier-config";

// Decision 172: without every verify_tier list land tiers each PR V3 (fail closed, decision 125),
// and a partial section counts as none. The values are the owner's, so doctor names what is missing.
export const tierConfig: Check = {
  id,
  async run(ctx) {
    const c = readLandConfig(ctx.home);
    if (!c.tier) {
      return {
        id,
        status: "notice",
        summary: `land 은 모든 PR 을 V3 로 본다: tier source ${tierSource(c)}`,
        fix: "add verify_tier.{docs_globs, test_globs, ui_globs, v3_globs} and protected_paths to ~/.config/sangsoe/config.json (README, Land: Verify tier)",
      };
    }
    return { id, status: "ok", summary: `검증 등급 설정 읽음: owners ${c.tier.owners.length}명, protected_paths ${c.tier.protected_paths.length}개` };
  },
};
