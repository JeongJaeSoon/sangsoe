import command, { stageRecord } from "../../../../cli/commands/stage-record.ts";
import { ports } from "../../world.ts";

export default { ...command, run: ({ values }) => stageRecord(values, ports()) } satisfies typeof command;
