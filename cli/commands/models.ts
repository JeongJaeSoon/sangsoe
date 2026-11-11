import { homedir } from "node:os";
import { activePins, modelsMarkdown, modelsView } from "../../core/index.ts";
import type { CommandDef } from "../contract.ts";

export default {
  name: "models",
  summary: "모델 표: 카탈로그 · 일의 종류별 정책 · 지금 걸린 고정 · 확인한 날 (core/models/table.ts, 읽기만)",
  usage: "[--markdown]",
  options: { markdown: { type: "boolean" } },
  run: ({ values }) => ({
    ok: true,
    value: values.markdown ? modelsMarkdown() : modelsView({ now: new Date(), pins: activePins(process.env, homedir()) }),
  }),
} satisfies CommandDef;
