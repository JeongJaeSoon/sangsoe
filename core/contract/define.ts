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

export function obj<S extends Shape>(shape: S): Validator<Infer<S>> {
  return (v, p) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(p, "object", v);
    const rec = v as Record<string, unknown>;
    for (const k of ORCA_OWNED_KEYS) {
      if (k in rec) throw new ContractError(`${p}.${k}: Orca owns this fact; store its id only`);
    }
    for (const [k, check] of Object.entries(shape)) {
      if (rec[k] === undefined) {
        if ("optional" in check) continue;
        fail(`${p}.${k}`, "a value", undefined);
      }
      check(rec[k], `${p}.${k}`);
    }
    return rec as Infer<S>;
  };
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
/** Orca ids (Task, Dispatch, Run, gate, message): opaque strings; the only Orca facts sqlite keeps. */
export const orcaId = str;
export const who = str;

export type Needs = "none" | "action" | "judgment";

export interface EventDef<T extends string = string, P = unknown> {
  readonly type: T;
  /** Payload format version; rows written at a lower schema_v are upcast on read. */
  readonly version: number;
  readonly payload: Validator<P>;
  /** dedupe_key prefix this type owns; see contract/dedupe.ts. */
  readonly dedupe: string;
  readonly needs: Needs;
  readonly upcast: Readonly<Record<number, (old: Record<string, unknown>) => Record<string, unknown>>>;
}

export function defineEvent<const T extends string, S extends Shape>(
  type: T,
  shape: S,
  opts: {
    dedupe?: string;
    needs?: Needs;
    version?: number;
    upcast?: Record<number, (old: Record<string, unknown>) => Record<string, unknown>>;
  } = {},
): EventDef<T, Infer<S>> {
  return {
    type,
    version: opts.version ?? 1,
    payload: obj(shape),
    dedupe: opts.dedupe ?? type,
    needs: opts.needs ?? "none",
    upcast: opts.upcast ?? {},
  };
}
