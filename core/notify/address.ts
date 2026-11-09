import { done, type Result, refuse } from "./result.ts";

// Orca's `send --to` also takes a terminal handle; sangsoe addresses only a Run's or a Dispatch's mailbox,
// which survive a restarted terminal (decision 80 N8).
const ADDRESS = /^(run|dispatch):[^\s:]+$/;

export function isTermHandle(id: string): boolean {
  return id.startsWith("term_");
}

export function reportAddress(addr: string): Result<string> {
  if (isTermHandle(addr) || isTermHandle(addr.replace(/^[a-z]+:/, ""))) {
    return refuse("term_address", `${addr} is a terminal handle`, "address the Run (run:<id>) or the Dispatch (dispatch:<id>)");
  }
  if (!ADDRESS.test(addr)) return refuse("address_form", `${addr} is not run:<id> or dispatch:<id>`, "use run:<id> or dispatch:<id>");
  return done(addr);
}

/** An Orca id as notify takes it: bare, never a handle and never an address it would wrap again. */
export function bareId(id: string): Result<string> {
  if (isTermHandle(id)) return refuse("address_form", `${id} is a terminal handle`, "pass the Dispatch or Run id");
  if (!/^[^\s:]+$/.test(id)) return refuse("address_form", `${id} is not a bare id`, "pass the id; notify builds the address");
  return done(id);
}
