import { existsSync } from "node:fs";
import { backupPath, hostRereadPending } from "../store/backup.ts";
import { defaultDbPath, LOST_SEPARATOR, Store } from "../store/store.ts";
import type { Check } from "./check.ts";

const id = "store-restore";

// Decisions 182-184: doctor is one of the opens that rebuilds a lost database from the own-facts
// backup, and it names what could not come back. A machine with neither file has nothing to check.
export const storeRestore: Check = {
  id,
  async run(ctx) {
    const path = defaultDbPath(ctx.home);
    if (!existsSync(path) && !existsSync(backupPath(path))) return { id, status: "ok", summary: "아직 데이터베이스가 없다" };
    const store = Store.open({ path });
    try {
      const signals = store.events({ type: "signal" });
      const last = signals.findLast((e) => e.payload.kind === "store_rebuilt");
      if (!last) return { id, status: "ok", summary: `sangsoe 고유 사실의 사본: ${backupPath(path)}` };
      const lost = String(last.payload.reason ?? "").split(LOST_SEPARATOR);
      const pending = hostRereadPending(signals);
      return {
        id,
        status: "notice",
        summary: [`${last.ts} 에 데이터베이스를 다시 세웠다. 되살리지 못한 것:`, ...lost.map((l) => `- ${l}`)].join("\n   "),
        fix: pending
          ? "Orca 가 열려 있으면 monitor 의 다음 회차가, 닫혀 있으면 Orca 를 열 때 monitor 가 Orca 와 GitHub 에서 호스트 행을 한 번 다시 읽는다(결정 191)"
          : "할 일 없음: 위 목록은 되살릴 수 없는 것이다",
      };
    } finally {
      store.close();
    }
  },
};
