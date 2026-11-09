import command, { reviewRecord } from "../../../../cli/commands/review-record.ts";
import { ports } from "../../world.ts";

export default { ...command, run: ({ values }) => reviewRecord(values, ports()) } satisfies typeof command;
