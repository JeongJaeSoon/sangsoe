import { createOrcaAdapter, nodeExec, type Role, runSlots, type StartPorts, Store, startUnit } from "../../../core/index.ts";

// Picked up by file name once the MCP server (U5) lands; the shape is its ToolDef.
const DEFAULT_LIMIT = 4;

/** The handler's body with its ports passed in, so tests drive the tool with a fake Orca. */
export async function handle(input: Record<string, unknown>, ports: StartPorts) {
  const s = (k: string) => (typeof input[k] === "string" && input[k] !== "" ? (input[k] as string) : undefined);
  const list = (k: string) => (Array.isArray(input[k]) ? (input[k] as unknown[]).map(String) : undefined);
  const taskId = s("taskId");
  const task = s("task");
  const spec = s("spec");
  if (!task && !spec) {
    return { ok: false, refusal: { code: "invalid_input", reason: "task 도 spec 도 없다", fix: "task 에 Task id 를 주거나 spec 으로 새 Task 를 만든다" } };
  }
  const title = s("title");
  const deps = list("deps");
  const lateAnswers = list("lateAnswers");
  const references = list("references");
  const out = await startUnit(ports, {
    requester: { role: s("role") as Role, worktreeId: s("worktreeId") ?? "", runId: s("runId") ?? "", ...(taskId ? { taskId } : {}) },
    childRole: s("childRole") === "lead" ? "lead" : "worker",
    task: task
      ? { id: task }
      : { spec: spec ?? "", ...(title ? { title } : {}), ...(deps ? { deps } : {}), ...(lateAnswers ? { lateAnswers } : {}) },
    agent: s("agent") ?? "claude",
    ...(references ? { references } : {}),
  });
  if (out.kind === "refused") {
    return {
      ok: false,
      refusal: {
        code: `start_refused:${out.reason}`,
        reason: out.detail,
        fix: "같은 일을 다른 길로 시작하지 않는다. 보고가 위로 갔으니 답을 기다린다(결정 94)",
      },
    };
  }
  return { ok: true, value: out };
}

export default {
  name: "start_unit",
  description:
    "Start one worker (or, for the orchestrator, a lead) on an item: the only way sangsoe opens a session. Refusals come back with their reason and are already escalated to whoever handed you the work.",
  inputSchema: {
    type: "object" as const,
    properties: {
      role: { type: "string" as const, enum: ["orchestrator", "lead", "worker"], description: "Your own role." },
      worktreeId: { type: "string" as const, description: "Your own Orca worktree id; the new worktree is its child." },
      taskId: { type: "string" as const, description: "Your own Task id (lead or worker)." },
      runId: { type: "string" as const, description: "The Run you hold." },
      childRole: { type: "string" as const, enum: ["lead", "worker"] },
      task: { type: "string" as const, description: "An existing Task id to start. Omit to create one from spec." },
      spec: { type: "string" as const, description: "The new Task's brief, acceptance criteria included. A /goal line in it does not take effect on a worker." },
      title: { type: "string" as const },
      deps: { type: "array" as const, items: { type: "string" as const } },
      lateAnswers: { type: "array" as const, items: { type: "string" as const }, description: "Answers that arrived after the last worker ended; added to the first prompt once." },
      references: { type: "array" as const, items: { type: "string" as const }, description: "Ticket URLs." },
      agent: { type: "string" as const, description: "Orca agent id, default claude." },
    },
    required: ["role", "worktreeId", "runId", "childRole"],
    additionalProperties: false,
  },
  async handler(input: Record<string, unknown>) {
    const orca = createOrcaAdapter(nodeExec(180_000));
    const store = Store.open();
    const runId = typeof input.runId === "string" ? input.runId : "";
    try {
      return await handle(input, { orca, store, slots: () => runSlots(orca, runId, DEFAULT_LIMIT), source: "mcp:start_unit" });
    } finally {
      store.close();
    }
  },
};
