import type {
  Exec,
  ExecResult,
  GateRow,
  HostRow,
  InboxMessage,
  InboxPayload,
  LocalRows,
  OrcaAdapter,
  OrcaResult,
  PortRow,
  WorkerPlacement,
  WriteOptions,
} from "../contract/orca.ts";
import { type CommandName, ORCA_COMMANDS } from "./commands.ts";
import { isLocalHost, keepLocal } from "./host-filter.ts";

type FlagValue = string | number | boolean | undefined;
type Call = { pos?: readonly string[]; flags?: Record<string, FlagValue> };
type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function buildArgs(name: CommandName, call: Call = {}, o?: WriteOptions): string[] {
  const spec = ORCA_COMMANDS[name];
  const allowed: readonly string[] = [...spec.flags, ...("optional" in spec ? spec.optional : [])];
  const pos = call.pos ?? [];
  // Orca would parse a leading dash as an option; whether it honours `--` is unverified.
  const dashed = pos.find((p) => p.startsWith("-"));
  if (dashed !== undefined) throw new Error(`orca ${spec.path.join(" ")}: argument ${JSON.stringify(dashed)} starts with "-"`);
  const args = [...spec.path, ...pos];
  const flags: Record<string, FlagValue> = { ...call.flags };
  if (o?.retryRequest) flags["retry-request"] = o.retryRequest;
  for (const [flag, value] of Object.entries(flags)) {
    if (value === undefined || value === false) continue;
    if (!allowed.includes(flag)) throw new Error(`orca ${spec.path.join(" ")}: --${flag} is not in ORCA_COMMANDS`);
    args.push(`--${flag}`);
    if (value !== true) args.push(String(value));
  }
  args.push("--json");
  return args;
}

const REQUEST_KEYS = new Set(["requestId", "retryRequest", "retry_request", "request_id"]);

/** Decision 60. Where Orca puts the id of a write is unverified (no writes while recording): look in both places. */
function findRequestId(json: unknown, stderr: string, depth = 0): string | undefined {
  if (depth < 5 && isObject(json)) {
    for (const [k, v] of Object.entries(json)) {
      if (REQUEST_KEYS.has(k) && typeof v === "string" && v !== "") return v;
      const inner = findRequestId(v, "", depth + 1);
      if (inner) return inner;
    }
  }
  return /--retry-request[ =]([A-Za-z0-9_.:-]+)/.exec(stderr)?.[1];
}

export function parseEnvelope(r: ExecResult, write: boolean): OrcaResult<unknown> {
  let json: unknown;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = undefined;
  }
  const requestId = write ? findRequestId(json, r.stderr) : undefined;
  const rid = requestId ? { requestId } : {};
  if (r.failure || !isObject(json)) {
    const why = r.failure ?? (r.code === 0 ? "no JSON on stdout" : `exit ${r.code}`);
    return { ok: false, error: { code: "response_lost", message: `${why}: ${r.stderr.trim().slice(0, 500)}` }, ...rid };
  }
  if (json.ok === false) {
    const e = isObject(json.error) ? json.error : {};
    const error = { code: String(e.code ?? "unknown"), message: String(e.message ?? "") };
    return { ok: false, error: "data" in e ? { ...error, data: e.data } : error, ...rid };
  }
  const value = json.ok === true ? json.result : json;
  if (r.code !== 0) {
    return { ok: false, error: { code: `exit_${r.code}`, message: r.stderr.trim().slice(0, 500), data: value }, ...rid };
  }
  return { ok: true, value, ...rid };
}

/**
 * Decision 60: a write whose response was lost is sent again only after `request-show`, and
 * only with the same request id. `absent` is not proof nothing happened, so it is not resent.
 */
export async function recoverWrite<T>(
  orca: OrcaAdapter,
  requestId: string,
  replay: (o: WriteOptions) => Promise<OrcaResult<T>>,
): Promise<OrcaResult<T>> {
  const shown = await orca.requestShow({ request: requestId });
  if (!shown.ok) return { ok: false, error: shown.error, requestId };
  const state: unknown = shown.value?.state;
  if (state === "completed" || state === "pending") return replay({ retryRequest: requestId });
  const message = shown.value?.interpretation ?? `request-show answered state ${JSON.stringify(state)}`;
  return { ok: false, error: { code: state === "absent" ? "request_absent" : "unexpected_shape", message }, requestId };
}

/** gate-list sends `options` as the JSON text gate-create was given; a value that is not a string array is dropped. */
function gateRow(row: Json): GateRow {
  const { options, ...rest } = row;
  let parsed: unknown;
  try {
    parsed = typeof options === "string" ? JSON.parse(options) : options;
  } catch {
    parsed = undefined;
  }
  const valid = Array.isArray(parsed) && parsed.every((x) => typeof x === "string");
  return { ...(rest as GateRow), ...(valid ? { options: parsed as string[] } : {}) };
}

const PAYLOAD_IDS = ["taskId", "dispatchId", "stopReason"] as const;

/** `inbox --full` rows: `from_handle`·`to_handle`·`read` (0 or 1) and `payload` as JSON text. */
export function inboxRow(row: Json): InboxMessage {
  let raw: unknown = row.payload;
  try {
    raw = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    raw = undefined;
  }
  const payload: InboxPayload = {};
  if (isObject(raw)) for (const k of PAYLOAD_IDS) if (typeof raw[k] === "string") payload[k] = raw[k];
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id: row.id as string,
    type: row.type as string,
    from: text(row.from_handle ?? row.from),
    to: text(row.to_handle ?? row.to),
    subject: text(row.subject),
    handled: row.read === 1 || row.read === true || row.handled === true,
    ...(typeof row.body === "string" ? { body: row.body } : {}),
    ...(Object.keys(payload).length > 0 ? { payload } : {}),
  };
}

function placement(p: WorkerPlacement): string {
  return typeof p === "string" ? p : p.existing;
}

export function createOrcaAdapter(exec: Exec, orcaBin = "orca"): OrcaAdapter {
  async function run<T>(name: CommandName, call?: Call, o?: WriteOptions): Promise<OrcaResult<T>> {
    const spec = ORCA_COMMANDS[name];
    let args: string[];
    try {
      args = buildArgs(name, call, o);
    } catch (err) {
      return { ok: false, error: { code: "invalid_argument", message: String((err as Error).message) } };
    }
    const r = await exec(orcaBin, args);
    return parseEnvelope(r, "write" in spec) as OrcaResult<T>;
  }

  const unexpected = (message: string, data: unknown) =>
    ({ ok: false, error: { code: "unexpected_shape", message, data } }) as const;

  /** Checks only what callers index into: the container, rows being objects, and named arrays. */
  async function shaped<T>(name: CommandName, valid: (v: unknown) => boolean, call?: Call): Promise<OrcaResult<T>> {
    const r = await run<unknown>(name, call);
    if (!r.ok || valid(r.value)) return r as OrcaResult<T>;
    return unexpected(`orca ${ORCA_COMMANDS[name].path.join(" ")}: result has an unexpected shape`, r.value);
  }

  type Kind = "string" | "number" | "array";
  const kindOf = (x: unknown): Kind | undefined =>
    typeof x === "string" ? "string" : typeof x === "number" ? "number" : Array.isArray(x) ? "array" : undefined;
  /** Rows that are objects carrying each named field with its kind. */
  const rowsWith =
    (fields: Record<string, Kind>) =>
    (v: unknown): v is Json[] =>
      Array.isArray(v) && v.every((row) => isObject(row) && Object.entries(fields).every(([k, kind]) => kindOf(row[k]) === kind));
  const has = (key: string, valid: (v: unknown) => boolean) => (v: unknown) => isObject(v) && valid(v[key]);
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

  async function field<T>(name: CommandName, key: string, valid: (v: unknown) => boolean, call?: Call): Promise<OrcaResult<T>> {
    const r = await shaped<Json>(name, has(key, valid), call);
    return r.ok ? { ok: true, value: r.value[key] as T } : r;
  }

  async function local<T>(
    name: CommandName,
    key: string,
    hostKey: string,
    idKey: string,
    call?: Call,
    nonLocalId?: (row: Json) => unknown,
  ): Promise<OrcaResult<LocalRows<T>>> {
    const r = await run<Json>(name, call);
    if (!r.ok) return r;
    if (!isObject(r.value) || !rowsWith({ [idKey]: "string" })(r.value[key])) {
      return unexpected(`no "${key}" rows in the result`, r.value);
    }
    const v = r.value;
    const scope = isObject(v.hostScope) ? v.hostScope : {};
    const omitted = Array.isArray(scope.omittedHostIds) ? scope.omittedHostIds.map(String) : [];
    const nextCursor = typeof v.nextCursor === "string" && v.nextCursor !== "" ? v.nextCursor : undefined;
    const page = { omittedHostIds: omitted, truncated: v.truncated === true || nextCursor !== undefined };
    const rows = keepLocal(
      v[key] as T[],
      (row) => (row as Json)[hostKey],
      page,
      nonLocalId && ((row: T) => nonLocalId(row as Json)),
    );
    return { ok: true, value: nextCursor ? { ...rows, nextCursor } : rows };
  }

  const jsonArray = (xs: readonly string[] | undefined) => (xs ? JSON.stringify(xs) : undefined);

  return {
    status: () => shaped("status", has("runtime", has("capabilities", strings))),
    hostList: () => field<HostRow[]>("hostList", "hosts", rowsWith({ id: "string", kind: "string" })),
    agentHooksStatus: () => shaped("agentHooksStatus", has("statuses", rowsWith({ agent: "string", state: "string" }))),
    agentContext: () => shaped("agentContext", has("commands", rowsWith({ path: "array", flags: "array" }))),
    diagnosticsMemory: () => run("diagnosticsMemory"),

    taskCreate: (a, o) =>
      run(
        "taskCreate",
        { flags: { spec: a.spec, "task-title": a.title, deps: jsonArray(a.deps), parent: a.parent, run: a.run } },
        o,
      ),
    taskList: (a) => field("taskList", "tasks", rowsWith({ id: "string", status: "string" }), { flags: { run: a.run, status: a.status, ready: a.ready, full: a.full } }),
    taskUpdate: (a, o) => run("taskUpdate", { flags: { id: a.id, status: a.status, result: a.result, run: a.run } }, o),

    runCurrent: () => shaped("runCurrent", isObject),
    runShow: async (a) => {
      const r = await shaped<Json>("runShow", has("run", has("id", (x) => typeof x === "string")), { flags: { id: a.id, full: true } });
      if (!r.ok) return r;
      const run = r.value.run as Json;
      const handle = run.coordinator_handle;
      return {
        ok: true,
        value: { runId: run.id as string, objective: String(run.objective ?? ""), ...(typeof handle === "string" && handle ? { coordinatorHandle: handle } : {}) },
      };
    },

    gateCreate: (a, o) =>
      run("gateCreate", { flags: { task: a.task, question: a.question, options: jsonArray(a.options) } }, o),
    gateResolve: (a, o) => run("gateResolve", { flags: { id: a.id, resolution: a.resolution } }, o),
    gateList: async (a) => {
      const r = await field<Json[]>("gateList", "gates", rowsWith({ id: "string", status: "string" }), { flags: { run: a.run, task: a.task, status: a.status } });
      return r.ok ? { ok: true, value: r.value.map(gateRow) } : r;
    },

    send: (a, o) =>
      run(
        "send",
        {
          flags: {
            to: a.to,
            subject: a.subject,
            body: a.body,
            type: a.type,
            from: a.from,
            "task-id": a.taskId,
            "dispatch-id": a.dispatchId,
            outcome: a.outcome,
          },
        },
        o,
      ),
    inbox: async (a) => {
      const r = await field<Json[]>("inbox", "messages", rowsWith({ id: "string", type: "string" }), { flags: { terminal: a.terminal, limit: a.limit, full: true } });
      return r.ok ? { ok: true, value: r.value.map(inboxRow) } : r;
    },

    workerStart: (a, o) =>
      run(
        "workerStart",
        {
          flags: {
            task: a.task,
            agent: a.agent,
            worktree: placement(a.worktree),
            run: a.run,
            model: a.model,
            effort: a.effort,
            advisor: a.advisor,
            "keep-open": a.keepOpen,
            repo: a.repo,
          },
        },
        o,
      ),
    workerShow: (a) => shaped("workerShow", isObject, { flags: { dispatch: a.dispatch } }),
    workerList: (a) =>
      local("workerList", "workers", "host", "dispatchId", { flags: { run: a.run, limit: a.limit, cursor: a.cursor } }),
    dispatchShow: (a) => field("dispatchShow", "dispatch", isObject, { flags: { task: a.task } }),
    requestShow: (a) => shaped("requestShow", isObject, { flags: { request: a.request } }),

    worktreeList: (a) =>
      local("worktreeList", "worktrees", "hostId", "id", { flags: { repo: a.repo, limit: a.limit } }, (row) => row.instanceId),
    worktreePs: (a) =>
      local("worktreePs", "worktrees", "hostId", "worktreeId", { flags: { limit: a.limit, "agent-wait": a.agentWait } }),
    worktreeRm: (a) => run("worktreeRm", { flags: { worktree: a.worktree, "run-hooks": true, "delete-branch": true } }),
    worktreeCreate: async (a) => {
      const r = await run<unknown>("worktreeCreate", {
        // Orca infers a parent from the caller's folder context; a top-level start forces none.
        flags: { name: a.name, ...(a.parent ? { "parent-worktree": a.parent } : { "no-parent": true }), repo: a.repo, setup: "run" },
      });
      if (!r.ok) return r;
      const w = isObject(r.value) && isObject(r.value.worktree) ? r.value.worktree : undefined;
      if (typeof w?.id !== "string" || typeof w.path !== "string") return unexpected("orca worktree create: no worktree id and path", r.value);
      return { ok: true, value: { id: w.id, path: w.path, ...(typeof w.repoId === "string" ? { repoId: w.repoId } : {}) } };
    },
    terminalList: (a) => local("terminalList", "terminals", "executionHostId", "handle", { flags: { worktree: a.worktree } }),
    terminalClose: (a) => run("terminalClose", { flags: { terminal: a.terminal } }),
    repoShow: async (a) => {
      const r = await shaped<Json>("repoShow", has("repo", isObject), { flags: { repo: a.repo } });
      if (!r.ok) return r;
      const hooks = (r.value.repo as Json).hookSettings;
      const setup = isObject(hooks) && isObject(hooks.scripts) ? hooks.scripts.setup : undefined;
      if (typeof setup !== "string") return unexpected("orca repo show: no hookSettings.scripts.setup", r.value);
      return { ok: true, value: { setup } };
    },
    ports: async (a) => {
      const r = await shaped<Json>("ports", has("ports", rowsWith({ id: "string", port: "number" })), { flags: { worktree: a.worktree } });
      if (!r.ok) return r;
      const host = r.value.executionHostId;
      if (!isLocalHost(host)) {
        return { ok: false, error: { code: "non_local_host", message: `orca ports scanned host ${String(host)}`, data: r.value } };
      }
      return { ok: true, value: r.value.ports as PortRow[] };
    },

    referenceAdd: (a) => run("referenceAdd", { pos: a.urls, flags: { worktree: a.worktree } }),
    referenceFind: (a) => run("referenceFind", { pos: [a.query], flags: { limit: a.limit } }),

    pluginList: () => field("pluginList", "plugins", rowsWith({ pluginKey: "string", version: "string", status: "string" })),
    pluginInspect: (a) => run("pluginInspect", { pos: [a.dir] }),
  };
}
