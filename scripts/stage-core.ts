// npm's prepack and postpack (decision 152): stage the core into orca-plugin/ for the packed tree,
// then remove the copy so a checkout's dev-loaded folder stays the git tree.
import { fileURLToPath } from "node:url";
import { stageCore, unstageCore } from "../core/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
await (process.argv.includes("--remove") ? unstageCore(root) : stageCore(root));
