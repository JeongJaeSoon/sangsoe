import type { Store } from "./store.ts";

/**
 * A store a long-lived runner keeps across rounds: the plugin worker's monitors and REAPER. Each use
 * first checks that the file at the path is still the one it opened; once it is not (a lost database
 * rebuilt by another opener, or moved aside), it opens again, so the round writes where every other
 * opener reads and sees the rebuild's reread signal (decision 191). A use already in flight keeps the
 * old connection, which closes when its last use returns.
 */
export interface HeldStore<B> {
  use<T>(fn: (bound: B) => Promise<T>): Promise<T>;
  close(): void;
}

export function holdStore<B>(open: () => Store, bind: (store: Store) => B): HeldStore<B> {
  type Held = { store: Store; bound: B; users: number };
  const hold = (store: Store): Held => ({ store, bound: bind(store), users: 0 });
  let cur = hold(open());
  return {
    async use(fn) {
      if (cur.store.replaced()) {
        // When this open throws, `cur` stays and the next use tries again.
        const next = hold(open());
        const old = cur;
        cur = next;
        if (old.users === 0) old.store.close();
      }
      const h = cur;
      h.users++;
      try {
        return await fn(h.bound);
      } finally {
        h.users--;
        if (h !== cur && h.users === 0) h.store.close();
      }
    },
    close: () => cur.store.close(),
  };
}
