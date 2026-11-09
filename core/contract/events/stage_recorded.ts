import { defineEvent, oneOf, prRef, sha } from "../define.ts";

export default defineEvent("stage_recorded", { pr: prRef, stage: oneOf("merge", "dev", "prod"), sha });
