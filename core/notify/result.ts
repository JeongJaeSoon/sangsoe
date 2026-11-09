import type { OrcaAdapter } from "../contract/orca.ts";
import type { Store } from "../store/store.ts";

/** The same three fields the MCP and CLI adapters show a caller when nothing was done. */
export interface Refusal {
  readonly code: string;
  readonly reason: string;
  readonly fix: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal };

export const done = <T>(value: T): Result<T> => ({ ok: true, value });
export const refuse = (code: string, reason: string, fix: string): { ok: false; refusal: Refusal } => ({
  ok: false,
  refusal: { code, reason, fix },
});

/** What every decision-loop function runs against: the event store and the Orca adapter. */
export interface CoreDeps {
  readonly store: Store;
  readonly orca: OrcaAdapter;
}
