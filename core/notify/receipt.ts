// Where Orca puts the new id in a write receipt is unrecorded (no writes while recording, decision 60).
// Look for `<kind>Id`, then `<kind>.id`, then a top-level `id`; anything else is "no id".
export function receiptId(receipt: unknown, kind: "gate" | "task" | "message"): string | undefined {
  if (typeof receipt !== "object" || receipt === null) return undefined;
  const r = receipt as Record<string, unknown>;
  const nested = r[kind];
  const candidates = [
    r[`${kind}Id`],
    typeof nested === "object" && nested !== null ? (nested as Record<string, unknown>).id : undefined,
    r.id,
  ];
  return candidates.find((v): v is string => typeof v === "string" && v !== "");
}
