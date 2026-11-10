import command, { evidenceRecord } from "../../../../cli/commands/evidence-record.ts";
import { ports } from "../../world.ts";

export default { ...command, run: ({ values }) => evidenceRecord(values, ports()) } satisfies typeof command;
