import type { StoredEvent } from "../contract/index.ts";
import { Store } from "../store/store.ts";

type Line = {
  ts: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  text?: string;
  [k: string]: unknown;
};

/**
 * Appends a JSONL event file to an in-memory store, each row at its own `ts`, and returns the stored
 * rows. Every line goes through Store.append, so a fixture the contract refuses fails here. Read-only
 * for the caller: nothing touches the real database.
 */
export function replayJsonl(jsonl: string): StoredEvent[] {
  let ts = "1970-01-01T00:00:00.000Z";
  const store = Store.open({ path: ":memory:", clock: () => ts });
  try {
    for (const raw of jsonl.split("\n").filter((l) => l.trim() !== "")) {
      const { ts: at, text, ...e } = JSON.parse(raw) as Line;
      ts = at;
      // biome-ignore lint/suspicious/noExplicitAny: a JSONL line is checked by the store, not by tsc.
      if (e.type === "owner_action") store.appendOwnerAction(e as any, text ?? e.payload.summary as string);
      // biome-ignore lint/suspicious/noExplicitAny: as above.
      else store.append(e as any);
    }
    return store.events();
  } finally {
    store.close();
  }
}
