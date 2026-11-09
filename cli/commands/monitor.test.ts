import assert from "node:assert/strict";
import { test } from "node:test";
import type { MonitorRunner } from "../../core/index.ts";
import { run } from "../main.ts";
import { monitor } from "./monitor.ts";

test("sangsoe monitor run <name> runs one round of the named monitor, dry run passed through", async () => {
  const opened: { dryRun: boolean; dbPath?: string }[] = [];
  let closed = 0;
  const fake = (o: { dryRun: boolean; dbPath?: string }): MonitorRunner => {
    opened.push(o);
    return {
      run: async (name) => ({ monitor: name, planned: [], written: [], unseen: [], aborted: false }),
      close: () => void closed++,
    };
  };
  const r = await monitor(["run", "chat"], { "dry-run": true, db: "/tmp/x.db" }, fake);
  assert.ok(r.ok && r.value.monitor === "chat");
  assert.deepEqual(opened, [{ dryRun: true, dbPath: "/tmp/x.db" }]);
  assert.equal(closed, 1);
});

test("an unknown monitor or verb is refused before anything opens", async () => {
  const never = (): MonitorRunner => {
    throw new Error("opened");
  };
  for (const args of [["run", "pr"], ["start", "orca"], ["run"]]) {
    const r = await monitor(args, {}, never);
    assert.equal(!r.ok && r.refusal.code, "invalid_input", args.join(" "));
  }
  assert.equal((await run(["monitor", "run", "orca", "--force"])).code, 2);
  assert.match((await run(["--help"])).out, /^\s+monitor\s/m);
});
