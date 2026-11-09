import { ORCA_COMMANDS } from "../orca/commands.ts";
import type { Check } from "./check.ts";

/** Decision 63: every command and flag the adapter passes must be in `orca agent-context --json`. */
const id = "orca-commands";

export const orcaCommands: Check = {
  id,
  async run({ orca }) {
    const ctx = await orca.agentContext();
    if (!ctx.ok) return { id: id, status: "fail", summary: `Orca 명령 스키마를 읽지 못했다 (${ctx.error.code})`, fix: "orca open" };
    const schema = new Map(ctx.value.commands.map((c) => [c.path.join(" "), new Set(c.flags)]));
    const gaps: string[] = [];
    for (const spec of Object.values(ORCA_COMMANDS)) {
      const name = spec.path.join(" ");
      const flags = schema.get(name);
      if (!flags) {
        gaps.push(name);
        continue;
      }
      for (const f of spec.flags) if (!flags.has(f)) gaps.push(`${name} --${f}`);
    }
    if (gaps.length > 0) {
      return { id: id, status: "fail", summary: `이 Orca 에 없는 명령·옵션: ${gaps.join(", ")}`, fix: "Orca 앱을 최신 버전으로 갱신한다" };
    }
    return { id: id, status: "ok", summary: `어댑터 명령 ${Object.keys(ORCA_COMMANDS).length}개가 모두 있다` };
  },
};
