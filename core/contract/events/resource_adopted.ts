import { defineEvent, refOrcaIdForWorktree, str } from "../define.ts";

// basis: the card list, or Docker's working_dir label. Adopting is not deleting.
export default defineEvent(
  "resource_adopted",
  { kind: str, ref: str, basis: str },
  { refine: refOrcaIdForWorktree },
);
