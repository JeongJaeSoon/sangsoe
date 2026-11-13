import type { OwnerTodoRow } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { READING_LABEL } from "../contract/views.ts";
import { type DecisionAnswered, decisionAnswer } from "../decision/answer.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { ownerDone } from "../owner/done.ts";
import { openResources } from "../reaper/open.ts";
import type { OwnerReap, OwnerReaped, ResourcePart, ResourcePartView, ResourceView } from "../reaper/resources.ts";
import { hashOf, mask, summarize } from "../session/mask.ts";
import { Store } from "../store/store.ts";
import { type BuildOptions, buildBrief, buildGroup, buildItem } from "./build.ts";
import { itemFacts } from "./item_status.ts";
import { loadBriefInput } from "./load.ts";
import { ownerTodoFrom } from "./owner_todo.ts";
import { localShort, localStamp, localZone } from "./time.ts";
import type { BriefInput, BriefModel, Overview } from "./types.ts";
import { watchStore } from "./watch.ts";

// The Orca plugin panel's entrance to the core (decision 136). The worker forwards panel requests here
// and draws what comes back; it counts nothing and changes no state itself.

export interface PanelTarget {
  readonly group?: string;
  readonly item?: string;
}

/** One stage of the brief plus the owner_todo rows its buttons are chosen by (a Row carries no kind). */
export interface PanelView {
  readonly model: BriefModel;
  readonly todo: readonly OwnerTodoRow[];
  /** The header's refresh time in the local zone: `short` on the row, `full` in its title (decision 198). */
  readonly fresh: { readonly short: string; readonly full: string };
  /** Status bar item B from this same reading, so the worker redraws both at once (decision 198). */
  readonly status: StatusBarItem;
}

export type PanelAct =
  | { readonly kind: "answer"; readonly decision: string; readonly choice: "recommended" }
  | { readonly kind: "answer"; readonly decision: string; readonly text: string }
  | { readonly kind: "done"; readonly item: string };

export type Tone = "neutral" | "danger";
export interface StatusBarItem {
  readonly text: string;
  readonly tone: Tone;
  readonly tooltip: string;
}

/** Orca's limit on a status bar item's text. */
export const STATUS_TEXT_MAX = 64;

/**
 * Status bar item B (decisions 92⑤, 170, 219): a ✨ SANGSOE label, then 🚧 blocked | open decisions | 🔄
 * doing, one space and a '|' between entries, read from the same Overview `sangsoe todo` and the brief's
 * top line print. Danger while anything is 🚧, the owner has a decision or a to-do, or a restart is due.
 */
export function statusBarItem(o: Overview): StatusBarItem {
  // Design N1: the owner types /clear, so a session due for a restart is the owner's to see.
  const restart = o.restartDue?.length ?? 0;
  const entries = ["✨ SANGSOE", `🚧 ${o.summary.blocked}`, `결정 ${o.todo.decisions}`, `🔄 ${o.summary.doing}`, ...(restart > 0 ? [`♻️ ${restart}`] : [])];
  const text = entries.join(" | ");
  return {
    text: text.slice(0, STATUS_TEXT_MAX),
    tone: o.summary.blocked > 0 || o.todo.total > 0 || restart > 0 ? "danger" : "neutral",
    tooltip: [`sangsoe: 내가 할 일 ${o.todo.total} (결정 ${o.todo.decisions} + 할 일 ${o.todo.other})`, ...(o.restartDue ?? [])].join("\n"),
  };
}

export function panelView(input: BriefInput, target: PanelTarget, opts: BuildOptions = {}): Result<PanelView> {
  const todo = ownerTodoFrom(input, itemFacts(input, opts.graph));
  let model: BriefModel | null;
  if (target.item) model = buildItem(input, target.item, opts);
  else if (target.group) model = buildGroup(input, target.group, opts);
  else model = buildBrief(input, opts);
  if (!model) return refuse("not_found", `no ${target.item ? `item ${target.item}` : `open group ${target.group}`}`, "go back to 현황");
  const overview = model.stage === 1 ? model : buildBrief(input, opts);
  const fresh = { short: localShort(input.now), full: `갱신 ${localStamp(input.now)} (${localZone(input.now)})` };
  return done({ model, todo, fresh, status: statusBarItem(overview) });
}

export interface PanelPorts {
  readonly orca: OrcaAdapter;
  /** Runs one act against the store; the worker's opens the file and closes it after. */
  readonly withStore: <T>(fn: (store: Store) => Promise<T>) => Promise<T>;
  readonly now: () => string;
  /** Reads the brief input; loadBriefInput (the store file and Orca) unless a test gives its own. */
  readonly load?: (now: string) => Promise<Result<BriefInput>>;
  /** Watches the store for new events; watchStore over the store file unless a test gives its own. */
  readonly watch?: (onChange: (seq: number) => void) => Result<{ close(): void }>;
  /** The 리소스 section's read and confirmed 정리 (decision 234); openResources unless a test gives its own. */
  readonly resources?: { read(): Promise<ResourceView>; part?(p: ResourcePart): Promise<ResourcePartView>; reap(a: OwnerReap): Promise<OwnerReaped> };
}

/**
 * The panel holds no Run, so no gate is resolved from it: decision_answer hands every open gate to the
 * Run that holds it (decision 77 라) and tells the waiters, exactly as an answer from another Run would.
 */
export const PANEL_RUN = "";

type ItemActed = { readonly status: "done" | "pending_verify"; readonly item: string };

/** What the panel prints after an act, per reply status (glossary terms: 닫힘, 원인이 사라진 결정, 검증 대기). */
export const ACTED_LABEL: Readonly<Record<(DecisionAnswered | ItemActed)["status"], string>> = {
  answered: "답이 달려 닫힘",
  late: "뒤늦은 답: 기록만 함(원인이 사라진 결정)",
  done: READING_LABEL.done,
  pending_verify: READING_LABEL.pending_verify,
};

// The panel shows `label`, never `status`: a to-do with a verify is not done yet (decision 181).
export type PanelActed = (DecisionAnswered | ItemActed) & { readonly label: string };

export interface PanelCore {
  brief(target: PanelTarget): Promise<Result<PanelView>>;
  statusBar(): Promise<Result<StatusBarItem>>;
  act(a: PanelAct): Promise<Result<PanelActed>>;
  /** The Orca worktree id a terminal for `target` opens in: the item's Dispatch worktree, or no_worktree. */
  worktree(target: PanelTarget): Promise<Result<{ readonly worktree: string }>>;
  /** Tells each new newest store seq until closed; the worker posts it to the open panels (decision 205). */
  watch(onChange: (seq: number) => void): Result<{ close(): void }>;
  /** The 리소스 section, read only when the owner opens or refreshes it (decision 234). */
  resources(): Promise<Result<ResourceView>>;
  /** Decision 235: one part of the 리소스 section, so the panel paints each as it comes. */
  resourcePart(p: ResourcePart): Promise<Result<ResourcePartView>>;
  /** The confirmed 정리: the owner's press is recorded as an owner_action, then only the listed ids go. */
  reap(a: OwnerReap): Promise<Result<OwnerReaped>>;
}

const NO_WORKTREE = "run the command in a terminal";

/**
 * Orca resolves `--worktree active` from the caller's cwd, and the plugin worker's is `/` (decision 198).
 * So the id comes from Orca's own worker-list row for the item's Task; a stage with no such row has none.
 */
async function itemWorktree(orca: OrcaAdapter, input: BriefInput, alias: string): Promise<Result<{ readonly worktree: string }>> {
  const f = itemFacts(input).find((x) => x.alias === alias);
  const task = f ? input.orca.tasks.find((t) => t.id === f.task) : undefined;
  if (!task) return refuse("not_found", `no item ${alias}`, NO_WORKTREE);
  const rows = await orca.workerList({ run: task.runId });
  if (!rows.ok) return refuse("orca_error", `worker-list ${task.runId}: ${rows.error.code}`, NO_WORKTREE);
  const ws = rows.value.rows.filter((w) => w.taskId === task.id && w.workspace).at(-1)?.workspace;
  return ws ? done({ worktree: ws }) : refuse("no_worktree", `${alias} has no worker worktree`, NO_WORKTREE);
}

export function panelCore(ports: PanelPorts): PanelCore {
  const load = ports.load ?? ((now: string) => loadBriefInput({ now, orca: ports.orca }));
  const res = () => ports.resources ?? openResources();

  async function answer(input: BriefInput, d: string, words: string | null): Promise<Result<PanelActed>> {
    let text = words?.trim() ?? "";
    if (words === null) {
      const row = buildBrief(input).decisions.rows.find((r) => r.id === d);
      if (!row) return refuse("not_open", `${d} is not an open decision`, "refresh the panel");
      text = row.cells[2]?.text ?? "—";
      if (text === "—") return refuse("no_recommendation", `${d} has no recommended answer`, "use 다른 답");
    }
    if (text === "") return refuse("bad_input", "answer: expected text", "type the answer");
    // Masked before anything is stored or sent (decision 34): the answer travels in the handoff too.
    const answerText = mask(text);
    const said = `${d} ${answerText}`;
    return ports.withStore(async (store) => {
      const action = store.appendOwnerAction(
        { type: "owner_action", source: "plugin:panel", payload: { origin: "button", summary: summarize(said), hash: hashOf(said) } },
        said,
      );
      const r = await decisionAnswer(
        { store, orca: ports.orca },
        { decision: d, answer: answerText, ownerAction: action.seq, linkedBy: "button", callerRun: PANEL_RUN },
      );
      return r.ok ? done({ ...r.value, label: ACTED_LABEL[r.value.status] }) : r;
    });
  }

  function closeItem(input: BriefInput, item: string): Promise<Result<PanelActed>> {
    return ports.withStore(async (store) => {
      const r = await ownerDone({ store, orca: ports.orca }, input, itemFacts(input), { task: item });
      if (!r.ok) return r;
      const status = r.value.pendingVerify ? "pending_verify" : "done";
      return done({ status, label: ACTED_LABEL[status], item: r.value.alias });
    });
  }

  return {
    async brief(target) {
      const input = await load(ports.now());
      return input.ok ? panelView(input.value, target) : input;
    },
    async statusBar() {
      const input = await load(ports.now());
      return input.ok ? done(statusBarItem(buildBrief(input.value))) : input;
    },
    async act(a) {
      const input = await load(ports.now());
      if (!input.ok) return input;
      if (a.kind === "done") return closeItem(input.value, a.item);
      return answer(input.value, a.decision, "text" in a ? a.text : null);
    },
    async worktree(target) {
      if (!target.item) return refuse("no_worktree", "this stage has no worktree of its own", NO_WORKTREE);
      const input = await load(ports.now());
      return input.ok ? itemWorktree(ports.orca, input.value, target.item) : input;
    },
    watch: (onChange) => (ports.watch ?? watchStore)(onChange),
    async resources() {
      return done(await res().read());
    },
    async resourcePart(p) {
      const r = res();
      return r.part ? done(await r.part(p)) : refuse("core_old", "this core reads the 리소스 section whole", "read it whole");
    },
    async reap(a) {
      if (a.worktrees.length === 0 && !a.tmp) return refuse("bad_input", "nothing to clean up", "press 정리 after the list shows something");
      const said = `리소스 정리: worktree ${a.worktrees.length}${a.tmp ? ", 임시 폴더" : ""}`;
      await ports.withStore(async (store) =>
        store.appendOwnerAction({ type: "owner_action", source: "plugin:panel", payload: { origin: "button", summary: summarize(said), hash: hashOf(said) } }, said),
      );
      return done(await res().reap(a));
    },
  };
}

/** The worker's PanelCore: the store file and Orca through the adapter, as the CLI uses them. */
export const openPanelCore = (): PanelCore =>
  panelCore({
    orca: createOrcaAdapter(nodeExec()),
    now: () => new Date().toISOString(),
    async withStore(fn) {
      const store = Store.open();
      try {
        return await fn(store);
      } finally {
        store.close();
      }
    },
  });
