import { createOrcaAdapter } from "../orca/adapter.ts";
import { nodeExec } from "../orca/exec.ts";
import type { CoreDeps } from "../notify/result.ts";
import { Store } from "../store/store.ts";

/** The real store and Orca for the CLI and MCP entrances; tests pass their own. Close the store after. */
export function defaultDeps(): CoreDeps {
  return { store: Store.open(), orca: createOrcaAdapter(nodeExec()) };
}
