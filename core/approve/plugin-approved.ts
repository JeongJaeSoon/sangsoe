// Event `plugin_approved` (decision 0104): written once per successful `sangsoe plugin approve`.
// TODO(U1): move into the core contract's one-file-per-event folder once it lands.
export type PluginApproved = {
  type: "plugin_approved";
  key: string;
  version: string;
  fingerprint: string;
  commit: string;
  at: number;
};

export function isPluginApproved(v: unknown): v is PluginApproved {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    e.type === "plugin_approved" &&
    typeof e.key === "string" &&
    typeof e.version === "string" &&
    typeof e.fingerprint === "string" &&
    typeof e.commit === "string" &&
    typeof e.at === "number"
  );
}
