import { createHash } from "node:crypto";
import type { OwnerTodoRow, ViewInput } from "../contract/index.ts";
import type { OrcaAdapter } from "../contract/orca.ts";
import { type DecisionAnswered, decisionAnswer } from "../decision/answer.ts";
import { done, type Result, refuse } from "../notify/result.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import { Store } from "../store/store.ts";
import { type BuildOptions, buildBrief, buildGroup, buildItem } from "./build.ts";
import { type ItemFacts, itemFacts } from "./item_status.ts";
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
 * Status bar item B (decision 92⑤): 🚧 blocked · open decisions · 🔄 doing, read from the same
 * Overview `sangsoe todo` and the brief's top line print. Danger while the owner has anything to do.
 */
export function statusBarItem(o: Overview): StatusBarItem {
  const text = `🚧${o.summary.blocked} · 결정${o.todo.decisions} · 🔄${o.summary.doing}`;
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

/** U14's ownerDone, taken as a port until core/owner lands on this base. */
export type OwnerDoneFn = (
  ports: { readonly orca: OrcaAdapter; readonly store: Store },
  input: ViewInput,
  facts: readonly ItemFacts[],
  a: { readonly task: string; readonly session?: string },
) => Promise<Result<{ readonly task: string; readonly alias: string; readonly evidenceShort: boolean }>>;

const ownerDoneMissing: OwnerDoneFn = async () =>
  refuse("not_available", "the 완료 button's core function (ownerDone) is not in this build", "close the item with its lead until the next release");

export interface PanelPorts {
  readonly orca: OrcaAdapter;
  /** Runs one act against the store; the worker's opens the file and closes it after. */
  readonly withStore: <T>(fn: (store: Store) => Promise<T>) => Promise<T>;
  readonly now: () => string;
  /** Reads the brief input; loadBriefInput (the store file and Orca) unless a test gives its own. */
  readonly load?: (now: string) => Promise<Result<BriefInput>>;
  readonly ownerDone?: OwnerDoneFn;
}

/**
 * The panel holds no Run, so no gate is resolved from it: decision_answer hands every open gate to the
 * Run that holds it (decision 77 라) and tells the waiters, exactly as an answer from another Run would.
 */
export const PANEL_RUN = "";

export type PanelActed = DecisionAnswered | { readonly status: "done"; readonly item: string; readonly evidenceShort: boolean };

export interface PanelCore {
  brief(target: PanelTarget): Promise<Result<PanelView>>;
  statusBar(): Promise<Result<StatusBarItem>>;
  act(a: PanelAct): Promise<Result<PanelActed>>;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

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
    return ports.withStore(async (store) => {
      const said = `${d} ${text}`;
      const action = store.appendOwnerAction(
        { type: "owner_action", source: "plugin:panel", payload: { origin: "button", summary: said, hash: hash(said) } },
        said,
      );
      return decisionAnswer(
        { store, orca: ports.orca },
        { decision: d, answer: text, ownerAction: action.seq, linkedBy: "button", callerRun: PANEL_RUN },
      );
    });
  }

  function ownerDone(input: BriefInput, item: string): Promise<Result<PanelActed>> {
    return ports.withStore(async (store) => {
      const r = await (ports.ownerDone ?? ownerDoneMissing)({ store, orca: ports.orca }, input, itemFacts(input), { task: item });
      return r.ok ? done({ status: "done", item: r.value.alias, evidenceShort: r.value.evidenceShort }) : r;
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
      if (a.kind === "done") return ownerDone(input.value, a.item);
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
