import type { OwnerTodoRow } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { READING_LABEL } from "../contract/views.ts";
import { type DecisionAnswered, decisionAnswer } from "../decision/answer.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { ownerDone } from "../owner/done.ts";
import { hashOf, mask, summarize } from "../session/mask.ts";
import { Store } from "../store/store.ts";
import { type BuildOptions, buildBrief, buildGroup, buildItem } from "./build.ts";
import { itemFacts } from "./item_status.ts";
import { loadBriefInput } from "./load.ts";
import { ownerTodoFrom } from "./owner_todo.ts";
import type { BriefInput, BriefModel, Overview } from "./types.ts";

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
 * Status bar item B (decisions 92⑤, 170): a ✨ SANGSOE label, then 🚧 blocked · open decisions · 🔄 doing,
 * read from the same Overview `sangsoe todo` and the brief's top line print. Danger while the owner
 * has anything to do.
 */
export function statusBarItem(o: Overview): StatusBarItem {
  const text = `✨ SANGSOE  🚧 ${o.summary.blocked} · 결정 ${o.todo.decisions} · 🔄 ${o.summary.doing}`;
  return {
    text: text.slice(0, STATUS_TEXT_MAX),
    tone: o.todo.total > 0 ? "danger" : "neutral",
    tooltip: `sangsoe: 내가 할 일 ${o.todo.total} (결정 ${o.todo.decisions} + 할 일 ${o.todo.other})`,
  };
}

export function panelView(input: BriefInput, target: PanelTarget, opts: BuildOptions = {}): Result<PanelView> {
  const todo = ownerTodoFrom(input, itemFacts(input, opts.graph));
  let model: BriefModel | null;
  if (target.item) model = buildItem(input, target.item, opts);
  else if (target.group) model = buildGroup(input, target.group, opts);
  else model = buildBrief(input, opts);
  if (!model) return refuse("not_found", `no ${target.item ? `item ${target.item}` : `open group ${target.group}`}`, "go back to 현황");
  return done({ model, todo });
}

export interface PanelPorts {
  readonly orca: OrcaAdapter;
  /** Runs one act against the store; the worker's opens the file and closes it after. */
  readonly withStore: <T>(fn: (store: Store) => Promise<T>) => Promise<T>;
  readonly now: () => string;
  /** Reads the brief input; loadBriefInput (the store file and Orca) unless a test gives its own. */
  readonly load?: (now: string) => Promise<Result<BriefInput>>;
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
}

export function panelCore(ports: PanelPorts): PanelCore {
  const load = ports.load ?? ((now: string) => loadBriefInput({ now, orca: ports.orca }));

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
