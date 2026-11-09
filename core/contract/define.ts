// Event payload validators. Hand-rolled so the core keeps zero runtime dependencies.
// Readers are tolerant: keys a validator does not name pass through untouched (appendix "모든 event 공통 칸").

export class ContractError extends Error {
  override name = "ContractError";
}

export type Validator<T> = (v: unknown, path: string) => T;
type Optional<T> = Validator<T> & { readonly optional: true };
type Shape = Record<string, Validator<unknown>>;

type Out<V> = V extends Validator<infer T> ? T : never;
type RequiredKeys<S extends Shape> = { [K in keyof S]: S[K] extends Optional<unknown> ? never : K }[keyof S];
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends Optional<unknown> ? K : never }[keyof S];
export type Infer<S extends Shape> = { [K in RequiredKeys<S>]: Out<S[K]> } & { [K in OptionalKeys<S>]?: Out<S[K]> };

const fail = (path: string, want: string, v: unknown): never => {
  throw new ContractError(`${path}: expected ${want}, got ${JSON.stringify(v)}`);
};

export const str: Validator<string> = (v, p) => (typeof v === "string" && v.length > 0 ? v : fail(p, "non-empty string", v));
export const text: Validator<string> = (v, p) => (typeof v === "string" ? v : fail(p, "string", v));
export const int: Validator<number> = (v, p) => (Number.isInteger(v) ? (v as number) : fail(p, "integer", v));
export const bool: Validator<boolean> = (v, p) => (typeof v === "boolean" ? v : fail(p, "boolean", v));

export function oneOf<const T extends readonly string[]>(...values: T): Validator<T[number]> {
  return (v, p) => (values.includes(v as string) ? (v as T[number]) : fail(p, `one of ${values.join("|")}`, v));
}

export function match(re: RegExp, want: string): Validator<string> {
  return (v, p) => (typeof v === "string" && re.test(v) ? v : fail(p, want, v));
}

export function arr<T>(item: Validator<T>): Validator<T[]> {
  return (v, p) => (Array.isArray(v) ? v.map((x, i) => item(x, `${p}[${i}]`)) : fail(p, "array", v));
}

export function opt<T>(inner: Validator<T>): Optional<T> {
  return Object.assign((v: unknown, p: string) => inner(v, p), { optional: true as const });
}

// Facts Orca owns (Task title/status/spec/deps, gate question and options, message bodies) never
// enter sqlite (decision 74); a payload that carries one is refused whatever its type.
export const ORCA_OWNED_KEYS = ["title", "status", "spec", "deps", "question", "options", "message_body"] as const;

export function rejectOrcaFacts(v: unknown, p: string): void {
  if (Array.isArray(v)) {
    v.forEach((x, i) => {
      rejectOrcaFacts(x, `${p}[${i}]`);
    });
    return;
  }
  if (typeof v !== "object" || v === null) return;
  for (const [k, x] of Object.entries(v)) {
    if ((ORCA_OWNED_KEYS as readonly string[]).includes(k)) {
      throw new ContractError(`${p}.${k}: Orca owns this fact; store its id only`);
    }
    rejectOrcaFacts(x, `${p}.${k}`);
  }
}

/** `refine` runs after the fields pass, for rules that tie one field to another. */
export function obj<S extends Shape>(shape: S, refine?: (v: Infer<S>, path: string) => void): Validator<Infer<S>> {
  return (v, p) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(p, "object", v);
    const rec = v as Record<string, unknown>;
    rejectOrcaFacts(rec, p);
    for (const [k, check] of Object.entries(shape)) {
      if (rec[k] === undefined) {
        if ("optional" in check) continue;
        fail(`${p}.${k}`, "a value", undefined);
      }
      check(rec[k], `${p}.${k}`);
    }
    refine?.(rec as Infer<S>, p);
    return rec as Infer<S>;
  };
}

// An owner item's verify probe (decision 91): one of five kinds, each with its own operands.
const VERIFY_OPERANDS: Readonly<Record<string, readonly string[]>> = {
  pr_merged: ["pr"],
  orca_field: ["target", "field", "value"],
  plugin_approved: ["key"],
  run_ok: ["repo"],
  pr_found: ["repo", "search"],
};
export const verifySpec = obj(
  {
    kind: oneOf("pr_merged", "orca_field", "plugin_approved", "run_ok", "pr_found"),
    pr: opt(match(/^[a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9][0-9]*$/, "lowercase owner/repo#N")),
    target: opt(str),
    field: opt(str),
    value: opt(str),
    key: opt(str),
    repo: opt(match(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/, "lowercase owner/repo")),
    /** run_ok's run id is filled from the owner's `!` output once the item is marked. */
    run: opt(str),
    search: opt(str),
  },
  (v, p) => {
    const rec = v as Record<string, unknown>;
    for (const k of VERIFY_OPERANDS[v.kind] ?? []) {
      if (rec[k] === undefined) throw new ContractError(`${p}.${k}: verify ${v.kind} needs ${k}`);
    }
  },
);

// A worktree is Orca's: a resource row names it by its Orca id, never by its path.
export function refOrcaIdForWorktree(v: Readonly<Record<string, unknown>>, p: string): void {
  if (v.kind === "worktree" && /[/\\]/.test(String(v.ref))) {
    throw new ContractError(`${p}.ref: a worktree is named by its Orca id, not a path`);
  }
}

// Shared field formats (appendix #schema "참조는 키로 잇는다").
export const prRef = match(/^[a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9][0-9]*$/, "lowercase owner/repo#N");
export const repo = match(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/, "lowercase owner/repo");
export const sha = match(/^[0-9a-f]{7,40}$/, "git sha");
export const itemNo = match(/^i[0-9]{3,}$/, "iNNN");
export const decisionNo = match(/^d[0-9]{3,}$/, "dNNN");
export const isoUtc = match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "ISO UTC timestamp");
export const priority = oneOf("P0", "P1", "P2", "P3");
export const edgeKind = oneOf("blocks", "after", "stacked_on", "deploys_after");
/** Orca ids (Task, Dispatch, Run, gate, message, worktree): the only Orca facts sqlite keeps. No ':' so a
 * dedupe_key segment holding one is unambiguous. */
export const orcaId = match(/^[^\s:]+$/, "Orca id without spaces or ':'");
export const who = str;

export type Needs = "none" | "action" | "judgment";

export interface EventDef<T extends string = string, P = unknown> {
  readonly type: T;
  /** Payload format version; rows written at a lower schema_v are upcast on read. */
  readonly version: number;
  readonly payload: Validator<P>;
  /** Payload keys this version knows; a new write may carry no other key. */
  readonly fields: readonly string[];
  /** dedupe_key prefix this type owns; see contract/dedupe.ts. */
  readonly dedupe: string;
  /** Writes without a dedupe_key are refused: the type's invariant rests on the key. */
  readonly dedupeRequired: boolean;
  /** The key's <target> derived from the payload, so a key cannot point at another row's subject. */
  dedupeTarget?(payload: P): string;
  /** When set, only these `source` values may write the type (e.g. edges only from GRAPH). */
  readonly sources: readonly string[] | null;
  /** Written only by a store method that keeps it atomic with other rows, never by Store.append. */
  readonly storeOnly: boolean;
  readonly needs: Needs;
  readonly upcast: Readonly<Record<number, (old: Record<string, unknown>) => Record<string, unknown>>>;
}

export function defineEvent<const T extends string, S extends Shape>(
  type: T,
  shape: S,
  opts: {
    refine?: (v: Readonly<Record<string, unknown>>, path: string) => void;
    dedupe?: string;
    dedupeRequired?: boolean;
    dedupeTarget?: (payload: Infer<S>) => string;
    sources?: readonly string[];
    storeOnly?: boolean;
    needs?: Needs;
    version?: number;
    upcast?: Record<number, (old: Record<string, unknown>) => Record<string, unknown>>;
  } = {},
): EventDef<T, Infer<S>> {
  return {
    type,
    version: opts.version ?? 1,
    payload: obj(shape, opts.refine),
    fields: Object.keys(shape),
    dedupe: opts.dedupe ?? type,
    dedupeRequired: opts.dedupeRequired ?? opts.dedupeTarget !== undefined,
    ...(opts.dedupeTarget ? { dedupeTarget: opts.dedupeTarget } : {}),
    sources: opts.sources ?? null,
    storeOnly: opts.storeOnly ?? false,
    needs: opts.needs ?? "none",
    upcast: opts.upcast ?? {},
  };
}
