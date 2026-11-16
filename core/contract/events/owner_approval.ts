import { defineEvent, int, match, prRef } from "../define.ts";

// Decision 311: the owner's typed `승인 <owner/repo>#<N> <head>` in the orchestrator's chat. Only the
// UserPromptSubmit hook writes it, in the same write as the owner_action it cites; land counts it as
// the owner's approval of that PR at exactly that head.
export default defineEvent(
  "owner_approval",
  { pr: prRef, head_sha: match(/^[0-9a-f]{40}$/, "full 40-character sha"), owner_action: int },
  { storeOnly: true, sources: ["UserPromptSubmit"] },
);
