import type { LocalRows } from "../contract/orca.ts";

export const LOCAL_HOST = "local";

/** Decision 88 ①: a missing or empty host is not local — when unsure, act on nothing. */
export function isLocalHost(hostId: unknown): boolean {
  return hostId === LOCAL_HOST;
}

export function keepLocal<T>(
  rows: readonly T[],
  hostOf: (row: T) => unknown,
  scope: { omittedHostIds?: readonly string[]; truncated?: boolean } = {},
  idOf?: (row: T) => unknown,
): LocalRows<T> {
  const local: T[] = [];
  const hostIds = new Set<string>();
  const ids: string[] = [];
  let nonLocal = 0;
  for (const row of rows) {
    const host = hostOf(row);
    if (isLocalHost(host)) {
      local.push(row);
      continue;
    }
    nonLocal++;
    hostIds.add(typeof host === "string" && host !== "" ? host : "(none)");
    const id = idOf?.(row);
    if (typeof id === "string" && id !== "") ids.push(id);
  }
  return {
    rows: local,
    nonLocal: { rows: nonLocal, hostIds: [...hostIds].sort(), ...(idOf ? { ids } : {}) },
    omittedHostIds: [...(scope.omittedHostIds ?? [])],
    truncated: scope.truncated ?? false,
  };
}
