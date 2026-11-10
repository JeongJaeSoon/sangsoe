// Every time a person reads is drawn in the system time zone; the store keeps UTC (decision 198).
// The formatter is built per call, so a TZ set after load (a test, a long-lived worker) is honoured.

function parts(iso: string): Record<string, string> | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" });
  return Object.fromEntries(f.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
}

/** `2026-11-10 21:00` in the local zone; the input unchanged when it is not a time. */
export function localStamp(iso: string): string {
  const p = parts(iso);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : iso;
}

/** `11-10 21:00`: the item chain's short form. */
export function localShort(iso: string): string {
  const p = parts(iso);
  return p ? `${p.month}-${p.day} ${p.hour}:${p.minute}` : iso;
}

/** The zone's short name (`GMT+9`, `UTC`), for a title that says which zone the stamp is in. */
export function localZone(iso: string): string {
  return parts(iso)?.timeZoneName ?? "";
}
