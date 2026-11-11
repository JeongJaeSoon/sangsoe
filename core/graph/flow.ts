import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViewInput } from "../contract/views.ts";
import type { CoreDeps, Result } from "../notify/result.ts";
import { done, refuse } from "../notify/result.ts";
import { createItem } from "../start/item.ts";
import { addEdgeTo, GRAPH_SOURCE } from "./edit.ts";
import { EDGE_KINDS, type EdgeKind, type Facts, foldFacts, type Stage } from "./facts.ts";
import { itemRef } from "./nodes.ts";
import { readSnapshot } from "./snapshot.ts";
import { parseToml, type TomlTable, TomlError, type TomlValue } from "./toml.ts";

// Flow templates (decision 28, appendix "흐름 틀 형식"): data, not code. Steps become an Orca root Task
// and one child Task each; a `blocks` need becomes the child's --deps at creation, any other kind an
// extra edge. No conditions, loops or "any of": several needs all have to be met.

export type Gate = "owner" | "timer" | "ci" | "pr";

export interface FlowStep {
  readonly id: string;
  readonly title: string;
  readonly doneWhen: string;
  readonly needs: readonly { readonly step: string; readonly kind: EdgeKind }[];
  readonly gate?: Gate;
  readonly whyOwner?: string;
  readonly stage?: Stage;
  /** For a timer or pr gate: the date or owner/repo#N, after var substitution. */
  readonly trigger?: string;
  /** A var holding comma-separated items this step waits on with Orca deps (ship-batch members). */
  readonly blocksOnVar?: string;
}

export interface FlowTemplate {
  readonly name: string;
  readonly version: number;
  readonly title: string;
  readonly vars: Readonly<Record<string, { readonly required: boolean; readonly default?: string; readonly enum?: readonly string[] }>>;
  readonly steps: readonly FlowStep[];
}

const GATES: readonly Gate[] = ["owner", "timer", "ci", "pr"];
const STAGES: readonly Stage[] = ["merge", "dev", "prod"];

const STEP_KEYS = ["id", "title", "done_when", "needs", "stage", "gate", "who", "why_owner", "trigger", "blocks_on_var"];

function fail(msg: string): never {
  throw new TomlError(msg);
}
const asStr = (v: TomlValue | undefined, where: string, required = true): string | undefined => {
  if (v === undefined && !required) return undefined;
  return typeof v === "string" && v.length > 0 ? v : fail(`${where}: expected a non-empty string`);
};

/** Validates a parsed template: unique ids, needs that name steps, known kinds and gates, no cycle. */
export function parseFlow(text: string): FlowTemplate {
  const t = parseToml(text);
  const name = asStr(t.name, "name") as string;
  if (typeof t.version !== "number") fail("version: expected an integer");
  const vars: Record<string, { required: boolean; default?: string; enum?: string[] }> = {};
  for (const [k, v] of Object.entries((t.vars ?? {}) as TomlTable)) {
    const spec = v as TomlTable;
    vars[k] = {
      required: spec.required === true,
      ...(spec.default !== undefined ? { default: asStr(spec.default, `vars.${k}.default`) as string } : {}),
      ...(Array.isArray(spec.enum) ? { enum: spec.enum.map((x, i) => asStr(x, `vars.${k}.enum[${i}]`) as string) } : {}),
    };
  }
  if (!Array.isArray(t.steps) || t.steps.length === 0) fail("steps: a template has at least one [[steps]]");
  const steps: FlowStep[] = (t.steps as TomlTable[]).map((s, i) => {
    const at = `steps[${i}]`;
    // A misspelt key (`need = …`) would silently drop a gate.
    const stray = Object.keys(s).filter((k) => !STEP_KEYS.includes(k));
    if (stray.length > 0) fail(`${at}: unknown key(s) ${stray.join(", ")}`);
    const id = asStr(s.id, `${at}.id`) as string;
    const gate = s.gate === undefined ? undefined : GATES.includes(s.gate as Gate) ? (s.gate as Gate) : fail(`${at}.gate: one of ${GATES.join(", ")}`);
    const stage = s.stage === undefined ? undefined : STAGES.includes(s.stage as Stage) ? (s.stage as Stage) : fail(`${at}.stage: one of ${STAGES.join(", ")}`);
    const needs = ((s.needs ?? []) as TomlValue[]).map((n, j) => {
      const need = n as TomlTable;
      const kind = need.kind as EdgeKind;
      if (!EDGE_KINDS.includes(kind)) fail(`${at}.needs[${j}].kind: one of ${EDGE_KINDS.join(", ")}`);
      return { step: asStr(need.step, `${at}.needs[${j}].step`) as string, kind };
    });
    if (gate === "owner" && (s.who !== "owner" || typeof s.why_owner !== "string")) fail(`${at}: an owner gate has who = "owner" and why_owner`);
    if ((gate === "timer" || gate === "pr") && typeof s.trigger !== "string") fail(`${at}: a ${gate} gate needs a trigger`);
    const whyOwner = asStr(s.why_owner, `${at}.why_owner`, false);
    const trigger = asStr(s.trigger, `${at}.trigger`, false);
    const blocksOnVar = asStr(s.blocks_on_var, `${at}.blocks_on_var`, false);
    return {
      id,
      title: asStr(s.title ?? id, `${at}.title`) as string,
      doneWhen: asStr(s.done_when, `${at}.done_when`) as string,
      needs,
      ...(gate ? { gate } : {}),
      ...(whyOwner ? { whyOwner } : {}),
      ...(stage ? { stage } : {}),
      ...(trigger ? { trigger } : {}),
      ...(blocksOnVar ? { blocksOnVar } : {}),
    };
  });
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) fail(`step ${s.id} appears twice`);
    ids.add(s.id);
  }
  for (const s of steps) {
    for (const n of s.needs) if (!ids.has(n.step)) fail(`step ${s.id} needs unknown step ${n.step}`);
    if (s.blocksOnVar && !(s.blocksOnVar in vars)) fail(`step ${s.id}: blocks_on_var ${s.blocksOnVar} is not a var`);
  }
  topoSteps(steps);
  return { name, version: t.version, title: asStr(t.title ?? name, "title") as string, vars, steps };
}

/** Steps in creation order: every need before its step, ties by template order. */
function topoSteps(steps: readonly FlowStep[]): FlowStep[] {
  const out: FlowStep[] = [];
  const placed = new Set<string>();
  while (out.length < steps.length) {
    const next = steps.find((s) => !placed.has(s.id) && s.needs.every((n) => placed.has(n.step)));
    if (!next) fail(`the steps' needs form a cycle among ${steps.filter((s) => !placed.has(s.id)).map((s) => s.id).join(", ")}`);
    out.push(next);
    placed.add(next.id);
  }
  return out;
}

export const BUNDLED_FLOWS = fileURLToPath(new URL("./flows/", import.meta.url));
export const userFlows = (home: string = homedir()) => join(home, ".config", "sangsoe", "flows");

/** `~/.config/sangsoe/flows/<name>.toml` overrides the bundled one (appendix). */
export function loadFlow(name: string, dirs: readonly string[] = [userFlows(), BUNDLED_FLOWS]): FlowTemplate {
  if (!/^[a-z0-9-]+$/.test(name)) throw new TomlError(`flow name ${JSON.stringify(name)}: lowercase letters, digits and -`);
  for (const d of dirs) {
    const p = join(d, `${name}.toml`);
    if (existsSync(p)) return parseFlow(readFileSync(p, "utf8"));
  }
  throw new TomlError(`no flow template ${name} in ${dirs.join(", ")}`);
}

export interface PlannedStep {
  readonly id: string;
  readonly title: string;
  readonly doneWhen: string;
  /** Orca --deps at creation: blocks needs (step ids) and member items (as given). */
  readonly depSteps: readonly string[];
  readonly depItems: readonly string[];
  readonly edges: readonly { readonly step: string; readonly kind: EdgeKind }[];
  readonly execBy?: "owner";
  readonly whyOwner?: string;
  readonly stage?: Stage;
  readonly trigger?: string;
}

export interface FlowPlan {
  readonly flow: string;
  readonly version: number;
  readonly title: string;
  readonly steps: readonly PlannedStep[];
}

/** `graph expand --dry-run`: the items and edges a template would make, nothing written. */
export function planFlow(t: FlowTemplate, given: Readonly<Record<string, string>>): Result<FlowPlan> {
  const vars: Record<string, string> = {};
  for (const [k, spec] of Object.entries(t.vars)) {
    const v = given[k]?.trim() || spec.default;
    if (v === undefined) {
      if (spec.required) return refuse("invalid_input", `var ${k} is required`, `pass ${k}=<value>`);
      continue;
    }
    if (spec.enum && !spec.enum.includes(v)) return refuse("invalid_input", `var ${k}=${v} is not one of ${spec.enum.join(", ")}`, `pass one of ${spec.enum.join(", ")}`);
    vars[k] = v;
  }
  const unknown = Object.keys(given).filter((k) => !(k in t.vars));
  if (unknown.length > 0) return refuse("invalid_input", `unknown var(s) ${unknown.join(", ")}`, `the template takes ${Object.keys(t.vars).join(", ") || "no vars"}`);
  let missing: string | undefined;
  const fill = (s: string) =>
    s.replace(/\{([A-Za-z0-9_-]+)\}/g, (_m, k: string) => {
      if (vars[k] === undefined) missing ??= k;
      return vars[k] ?? "";
    });
  const steps = topoSteps(t.steps).map((s): PlannedStep => {
    const members = s.blocksOnVar ? (vars[s.blocksOnVar] ?? "").split(",").map((x) => x.trim()).filter(Boolean) : [];
    const trigger = s.trigger ? fill(s.trigger) : undefined;
    return {
      id: s.id,
      title: fill(s.title),
      doneWhen: fill(s.doneWhen),
      depSteps: s.needs.filter((n) => n.kind === "blocks").map((n) => n.step),
      depItems: members,
      edges: s.needs.filter((n) => n.kind !== "blocks"),
      ...(s.gate === "owner" ? { execBy: "owner" as const, whyOwner: fill(s.whyOwner ?? "") } : {}),
      ...(s.stage ? { stage: s.stage } : {}),
      ...(trigger ? { trigger } : {}),
    };
  });
  if (missing !== undefined) return refuse("invalid_input", `var ${missing} is used but not given`, `pass ${missing}=<value>`);
  return done({ flow: t.name, version: t.version, title: fill(t.title), steps });
}

export interface Expanded {
  readonly root: string;
  readonly steps: Readonly<Record<string, string>>;
  readonly resumed: boolean;
}

const requestLink = (id: string) => `request:${id}`;

/**
 * `graph expand`: root Task, then each step in need order. Resumable: a request id finds the root
 * already made, and a step already made (flow + step) is not made again.
 */
export async function expandFlow(
  deps: CoreDeps,
  a: { plan: FlowPlan; run: string; who: string; requestId: string },
): Promise<Result<Expanded>> {
  if (a.requestId.trim() === "") return refuse("invalid_input", "expanding needs a request id", "pass a request id; re-running with it resumes");
  // Read before any create: a read failing after a create would leave that step without its gate.
  // The snapshot goes stale as steps are made; addEdgeTo still knows them by alias, and a new step has
  // no out-edge yet, so no cycle can run through it.
  const snap = await readSnapshot(deps.orca, [a.run]);
  if (snap.unread.length > 0) return refuse("orca_unreadable", `task-list ${a.run} failed`, "re-run with the same request id once Orca answers");
  let facts = foldFacts(deps.store.events());
  const resolve = (ref: string) => facts.aliases.get(ref.replace(/^item:/, "")) ?? ref.replace(/^item:/, "");
  let root = [...facts.items.values()].find((x) => x.links?.includes(requestLink(a.requestId)))?.task;
  const resumed = root !== undefined;
  if (!root) {
    const r = await createItem(deps.orca, deps.store, { run: a.run, spec: `흐름 ${a.plan.flow} v${a.plan.version}: ${a.plan.title}`, title: a.plan.title, who: a.who, doneWhen: "모든 단계가 끝나고 범위 안 PR 이 머지되거나 이유와 함께 취소된다" });
    if (!r.ok) return refuse(r.code, r.error, "check the Run id; re-run with the same request id to resume");
    root = r.task;
    deps.store.append({ type: "item_extra_set", source: GRAPH_SOURCE, payload: { task: root, flow: root, links: [requestLink(a.requestId)] } });
  }
  // Recorded before the steps, so an expansion cut short shows its missing steps as flow_gap.
  if (!foldFacts(deps.store.events()).flows.some((f) => f.parent === root)) {
    deps.store.append({
      type: "flow_expanded",
      source: GRAPH_SOURCE,
      subject: itemRef(root),
      payload: { flow: a.plan.flow, version: String(a.plan.version), parent: root, steps: a.plan.steps.map((s) => s.id) },
    });
  }
  const made: Record<string, string> = {};
  // Steps come in need order, so a step's non-blocks predecessors exist when it is made; its edges
  // go in right after it with no Orca call between, so only a crash there leaves a step ungated.
  const gate = (s: PlannedStep): Result<true> => {
    for (const e of s.edges) {
      const w = addEdgeTo(deps, snap.snapshot, { pred: itemRef(made[e.step] as string), succ: itemRef(made[s.id] as string), kind: e.kind });
      if (!w.ok) return refuse(w.refusal.code, `step ${s.id}: ${w.refusal.reason}`, w.refusal.fix);
    }
    return done(true);
  };
  for (const s of a.plan.steps) {
    facts = foldFacts(deps.store.events());
    const existing = [...facts.items.values()].find((x) => x.flow === root && x.step === s.id);
    if (existing) {
      made[s.id] = existing.task;
      const g = gate(s);
      if (!g.ok) return g;
      continue;
    }
    const taskDeps = [...s.depSteps.map((id) => made[id] as string), ...s.depItems.map(resolve)];
    const r = await createItem(deps.orca, deps.store, {
      run: a.run,
      spec: `${a.plan.flow} 단계 ${s.id}: ${s.title}\n끝나는 조건: ${s.doneWhen}`,
      title: s.title,
      who: s.execBy === "owner" ? "owner" : a.who,
      doneWhen: s.doneWhen,
      parent: root,
      ...(taskDeps.length ? { deps: taskDeps } : {}),
    });
    if (!r.ok) return refuse(r.code, `step ${s.id}: ${r.error}`, "fix the cause and re-run with the same request id to resume");
    made[s.id] = r.task;
    deps.store.append({
      type: "item_extra_set",
      source: GRAPH_SOURCE,
      payload: {
        task: r.task,
        flow: root,
        step: s.id,
        ...(s.stage ? { stage: s.stage } : {}),
        ...(s.execBy ? { exec_by: s.execBy, why_owner: s.whyOwner } : {}),
        ...(s.trigger ? { trigger: s.trigger } : {}),
      },
    });
    const g = gate(s);
    if (!g.ok) return g;
  }
  return done({ root, steps: made, resumed });
}

/** `flow_gap`: template steps the expanded flow lacks and did not skip with a reason. */
export function flowGap(facts: Facts, root: string): string[] {
  const rec = facts.flows.find((f) => f.parent === root);
  if (!rec) return [];
  const have = new Set([...facts.items.values()].filter((x) => x.flow === root && x.step).map((x) => x.step));
  return rec.steps.filter((s) => !have.has(s) && !facts.skipped.has(`${root}/${s}`));
}

export interface DoneBy {
  /** The owner's own action is the ground for this transition. */
  readonly owner?: boolean;
  /** seq of the owner_action row it rests on. */
  readonly ownerAction?: number;
}

/**
 * `done_blockers`: why an item may not go to ✅. An owner-gated step needs the owner's owner_action
 * (decision 49); a flow root needs every step present (flow_gap), finished, and every PR in scope
 * merged, or closed with its item cancelled (decision 47, early_done).
 */
export function doneBlockers(input: ViewInput, task: string, by: DoneBy = {}): string[] {
  const facts = foldFacts(input.events);
  const id = facts.aliases.get(task) ?? task;
  const tasks = new Map(input.orca.tasks.map((t) => [t.id, t]));
  const out: string[] = [];
  const x = facts.items.get(id);
  if (x?.execBy === "owner" && !(by.owner && by.ownerAction !== undefined && facts.ownerActions.has(by.ownerAction))) {
    out.push("owner_gate: 오너만 ✅ 로 쓴다(owner_action 근거가 필요하다)");
  }
  const children = [...facts.items.values()].filter((c) => c.flow === id && c.step);
  const scope = [id, ...children.map((c) => c.task)];
  if (facts.flows.some((f) => f.parent === id)) for (const s of flowGap(facts, id)) out.push(`flow_gap: ${s}`);
  for (const c of children) {
    const t = tasks.get(c.task);
    const finished = t?.status === "completed" || (t?.status === "failed" && t.result === "cancelled");
    if (!finished) out.push(`open_child: ${c.alias ?? c.task} (${c.step})`);
  }
  // A closed PR whose task later merged another PR was replaced, not abandoned.
  const landed = new Set([...facts.prs.values()].filter((p) => p.merged).flatMap((p) => [...p.tasks]));
  for (const p of facts.prs.values()) {
    const bound = [...p.tasks].filter((t) => scope.includes(t));
    if (bound.length === 0 || p.merged) continue;
    if (!p.closed) out.push(`open_pr: ${p.pr}`);
    else
      for (const t of bound) {
        const cancelled = tasks.get(t)?.status === "failed" && tasks.get(t)?.result === "cancelled";
        // Decision 223: a completed item cannot be cancelled in Orca; its item_retired row is that reason.
        if (!landed.has(t) && !cancelled && !facts.items.get(t)?.retired) out.push(`closed_pr: ${p.pr} (열린 항목은 취소하고, 완료된 항목은 item_retire 로 이유와 함께 거둔다)`);
      }
  }
  return out;
}
