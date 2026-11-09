import type { OwnerTodoView } from "../contract/index.ts";
import { ownerTodoFrom } from "../owner/todo.ts";
import { itemFacts } from "./item_status.ts";

// The body is core/owner's (decision 134); the brief folds the item facts once and hands them over.
export { ownerTodoFrom };

export const owner_todo: OwnerTodoView = (input) => ownerTodoFrom(input, itemFacts(input));
