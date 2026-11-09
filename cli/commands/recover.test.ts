import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrcaAdapter } from "../../core/index.ts";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import { run } from "../main.ts";
import { recover } from "./recover.ts";

test("sangsoe recover prints the table and exits 0", async () => {
  const r = await recover({}, createOrcaAdapter(createFakeOrca().exec));
  assert.ok("lines" in r && r.code === 0);
  assert.match(r.lines.join("\n"), /\| · \| task_000000000001 \| ctx_000000000001/);
});

test("sangsoe recover and item new: the router rejects an unknown option, the command a bad limit", async () => {
  assert.equal((await run(["recover", "--force"])).code, 2);
  assert.equal((await run(["item", "new", "--force"])).code, 2);
  const bad = await recover({ limit: "0" }, createOrcaAdapter(createFakeOrca().exec));
  assert.equal("ok" in bad && !bad.ok && bad.refusal.code, "invalid_input");
  const help = (await run(["--help"])).out;
  assert.match(help, /^\s+recover\s/m);
  assert.match(help, /^\s+item new\s/m);
});
