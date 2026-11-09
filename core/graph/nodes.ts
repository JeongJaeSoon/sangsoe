// Node names on an edge (appendix #dependencies-detail): a predecessor is an item, a PR or a decision;
// a successor is always an item. An item is named by its Orca Task id, never its iNNN alias.

export type GraphNode =
  | { readonly kind: "item"; readonly task: string }
  | { readonly kind: "pr"; readonly pr: string }
  | { readonly kind: "decision"; readonly decision: string };

const PR = /^[a-z0-9_.-]+\/[a-z0-9_.-]+#[1-9][0-9]*$/;
const DECISION = /^d[0-9]{3,}$/;

export const itemRef = (task: string): string => `item:${task}`;
export const prNode = (pr: string): string => `pr:${pr}`;

export function parseNode(ref: string): GraphNode | undefined {
  const i = ref.indexOf(":");
  if (i <= 0) return undefined;
  const [head, rest] = [ref.slice(0, i), ref.slice(i + 1)];
  if (head === "item" && rest.length > 0 && !/\s/.test(rest)) return { kind: "item", task: rest };
  if (head === "pr" && PR.test(rest)) return { kind: "pr", pr: rest };
  if (head === "decision" && DECISION.test(rest)) return { kind: "decision", decision: rest };
  return undefined;
}
