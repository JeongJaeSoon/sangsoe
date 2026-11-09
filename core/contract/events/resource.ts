import { defineEvent, oneOf, refOrcaIdForWorktree, str, who } from "../define.ts";

// Written by whoever made the resource (Docker objects by id right after compose up).
export default defineEvent(
  "resource",
  {
    action: oneOf("created", "released"),
    kind: str,
    owner: who,
    ref: str,
  },
  { refine: refOrcaIdForWorktree },
);
