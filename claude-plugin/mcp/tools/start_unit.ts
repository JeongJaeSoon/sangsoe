import {
  classKind,
  createOrcaAdapter,
  EFFORTS,
  type Effort,
  isEffort,
  isModelKind,
  isUnitClass,
  MODEL_KINDS,
  MODEL_TIERS,
  type ModelTier,
  nodeExec,
  REPO_SELECTOR,
  type Role,
  resolveModel,
  runSlots,
  type StartPorts,
  Store,
  startUnit,
  UNIT_CLASSES,
  type UnitClass,
} from "../../../core/index.ts";
import type { Outcome, Refusal, ToolDef } from "../contract.ts";

const DEFAULT_LIMIT = 4;
const ROLES: readonly Role[] = ["orchestrator", "lead", "worker"];

function storedClass(store: StartPorts["store"], task: string): UnitClass | undefined {
  const rows = store.events({ type: "item_extra_set" }).filter((e) => e.payload.task === task && typeof e.payload.unit_class === "string");
  const last = rows.at(-1)?.payload.unit_class;
  return typeof last === "string" && isUnitClass(last) ? last : undefined;
}

const invalid = (reason: string, fix: string): Outcome => ({ ok: false, refusal: { code: "invalid_input", reason, fix } });

/** The handler's body with its ports passed in, so tests drive the tool with a fake Orca. */
export async function handle(input: Record<string, unknown>, ports: StartPorts): Promise<Outcome> {
  const s = (k: string) => (typeof input[k] === "string" && input[k] !== "" ? (input[k] as string) : undefined);
  const list = (k: string) => (Array.isArray(input[k]) ? (input[k] as unknown[]).map(String) : undefined);
  const taskId = s("taskId");
  const task = s("task");
  const spec = s("spec");
  if (!task && !spec) return invalid("neither task nor spec was given", "pass task (an existing Task id) or spec (a new Task)");
  const role = s("role");
  const childRole = s("childRole");
  if (!ROLES.includes(role as Role) || (childRole !== "lead" && childRole !== "worker")) {
    return invalid(`role "${role}" or childRole "${childRole}" is not an allowed value`, "role: orchestrator|lead|worker, childRole: lead|worker");
  }
  const title = s("title");
  const deps = list("deps");
  const lateAnswers = list("lateAnswers");
  // An existing Task's spec is already written; the answers would be dropped, so say so.
  if (task && lateAnswers?.length) {
    return invalid("lateAnswers go only into a new Task's first prompt", "omit task and pass spec with lateAnswers to create and start a new Task");
  }
  const references = list("references");
  const given = s("class");
  if (given !== undefined && (!isUnitClass(given) || childRole === "lead")) {
    return invalid(`class "${given}" is not a worker unit class`, `class (workers only): ${UNIT_CLASSES.join("|")}`);
  }
  // An existing Task's class was set by item_create; an explicit class or kind wins over it.
  const unitClass = given ?? (task && !s("kind") ? storedClass(ports.store, task) : undefined);
  if (unitClass && s("kind") && s("kind") !== classKind(unitClass)) {
    return invalid(`kind "${s("kind")}" and class "${unitClass}" disagree`, "pass one of them");
  }
  const kind = s("kind") ?? (unitClass ? classKind(unitClass) : childRole);
  if (!isModelKind(kind) || (childRole === "lead" ? kind !== "lead" : kind === "lead" || kind === "orchestrator")) {
    return invalid(`kind "${kind}" does not fit childRole ${childRole}`, "a lead is kind lead; a worker is worker, hard, design, review, release-review or sweep");
  }
  const effort = s("effort");
  const tier = s("tier");
  if (effort && !isEffort(effort)) return invalid(`effort "${effort}" is not a level`, `effort: ${EFFORTS.join("|")}`);
  if (tier && !(MODEL_TIERS as readonly string[]).includes(tier)) return invalid(`tier "${tier}" is not a tier`, "read resource models for the tiers");
  const reason = s("reason");
  const model = resolveModel(kind, {
    ...(effort ? { effort: effort as Effort } : {}),
    ...(tier ? { tier: tier as ModelTier } : {}),
    ...(reason ? { reason } : {}),
  });
  if (!model.ok) return invalid(model.reason, "read resource models: raise effort along the row's ladder first, then its next tier with a reason");
  const repo = s("repo");
  if (repo && !REPO_SELECTOR.test(repo)) return invalid(`repo "${repo}" is not an Orca repo selector`, "repo: id:<id>, name:<name> or path:<path>");
  const worktreeId = s("worktreeId");
  if (!worktreeId && role !== "orchestrator") {
    return invalid("worktreeId is missing", "pass your own worktreeId; only an orchestrator outside every worktree leaves it out, and then passes repo");
  }
  const out = await startUnit(ports, {
    requester: { role: role as Role, ...(worktreeId ? { worktreeId } : {}), runId: s("runId") ?? "", ...(taskId ? { taskId } : {}) },
    ...(repo ? { repo } : {}),
    childRole,
    task: task
      ? { id: task }
      : { spec: spec ?? "", ...(title ? { title } : {}), ...(deps ? { deps } : {}), ...(lateAnswers ? { lateAnswers } : {}) },
    agent: s("agent") ?? "claude",
    ...(references ? { references } : {}),
    model: model.value,
  });
  // A class given here stays with the Task, so a restart by id without one keeps it.
  const startedTask = "taskId" in out ? out.taskId : undefined;
  if (given && startedTask && storedClass(ports.store, startedTask) !== given) {
    ports.store.append({ type: "item_extra_set", source: "mcp:start_unit", payload: { task: startedTask, unit_class: given }, entity: "task", entity_id: startedTask });
  }
  if (out.kind === "refused") {
    const refusal: Refusal = {
      code: out.reason,
      reason: out.detail,
      fix: "do not start the same work another way; the refusal was escalated, wait for the answer (decision 94)",
    };
    return { ok: false, refusal };
  }
  return { ok: true, value: out };
}

export default {
  name: "start_unit",
  description:
    "Start one worker (or, for the orchestrator, a lead) on an item: the only way sangsoe opens a session. Refusals come back with their reason and are already escalated to whoever handed you the work.",
  inputSchema: {
    type: "object",
    properties: {
      role: { type: "string", enum: ["orchestrator", "lead", "worker"], description: "Your own role." },
      worktreeId: {
        type: "string",
        description: "Your own Orca worktree id; the new worktree is its child. Only an orchestrator running in no Orca worktree leaves it out, and then passes repo.",
      },
      repo: {
        type: "string",
        description: "The Orca repo selector (id:, name: or path:) the new worktree goes in, when it is not your own repo. Default: the repo item_create recorded, else yours.",
      },
      taskId: { type: "string", description: "Your own Task id (lead or worker)." },
      runId: { type: "string", description: "The Run you hold." },
      childRole: { type: "string", enum: ["lead", "worker"] },
      task: { type: "string", description: "An existing Task id to start. Omit to create one from spec." },
      spec: { type: "string", description: "The new Task's brief, acceptance criteria included. A /goal line in it does not take effect on a worker." },
      title: { type: "string" },
      deps: { type: "array", items: { type: "string" } },
      lateAnswers: {
        type: "array",
        items: { type: "string" },
        description: "Answers that arrived after the last worker ended; only with spec (a new Task), added to its first prompt.",
      },
      references: { type: "array", items: { type: "string" }, description: "Ticket URLs." },
      agent: { type: "string", description: "Orca agent id, default claude." },
      class: {
        type: "string",
        enum: [...UNIT_CLASSES],
        description:
          "Workers: the unit class (default, hard, design, mechanical); picks main model, advisor and effort from resource models. Default: the class item_create recorded, else default.",
      },
      kind: {
        type: "string",
        enum: MODEL_KINDS.filter((k) => k !== "orchestrator"),
        description: "The kind of work when it is not a unit class (review, release-review); picks the model from resource models. Default: the class's kind, else the childRole.",
      },
      effort: { type: "string", enum: [...EFFORTS], description: "A higher effort from the kind's ladder; needs reason." },
      tier: { type: "string", enum: [...MODEL_TIERS], description: "The kind's next tier, only from the ladder's last effort; needs reason." },
      reason: { type: "string", description: "Why the default model or effort falls short; recorded as model_changed." },
    },
    required: ["role", "runId", "childRole"],
    additionalProperties: false,
  },
  async handler(input) {
    const orca = createOrcaAdapter(nodeExec(180_000));
    const store = Store.open();
    const runId = typeof input.runId === "string" ? input.runId : "";
    try {
      return await handle(input, { orca, store, slots: () => runSlots(orca, runId, DEFAULT_LIMIT), source: "mcp:start_unit" });
    } finally {
      store.close();
    }
  },
} satisfies ToolDef;
