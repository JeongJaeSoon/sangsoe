import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Decision 91's input-linking and release rules have one body, core/owner (decision 146). The hooks
// in core/session call it and keep none of their own.

// Read as files, not imported: built with join so the layout test does not take it for an import.
const dir = pathToFileURL(`${join(fileURLToPath(new URL("../..", import.meta.url)), "core", "session")}/`);
const GONE = ["WATCH_COMMANDS", "openHints", "owner_act_unlinked", "owner_act:", "waiting_released", "function release", "startsWith(w)"];

test("core/session holds no decision-91 linking or release rule", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(files.includes("shell.ts") && files.includes("record.ts"));
  const hits = files.flatMap((f) => {
    const text = readFileSync(new URL(f, dir), "utf8");
    return GONE.filter((word) => text.includes(word)).map((word) => `${f}: ${word}`);
  });
  assert.deepEqual(hits, []);
});
