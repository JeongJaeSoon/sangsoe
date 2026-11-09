import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import { createOrcaAdapter } from "./adapter.ts";
import { isLocalHost, keepLocal } from "./host-filter.ts";

test("only hostId local is local; missing, empty and other hosts are not", () => {
  assert.equal(isLocalHost("local"), true);
  for (const h of [undefined, null, "", "LOCAL", "ssh-1", 0]) assert.equal(isLocalHost(h), false, String(h));
});

test("keepLocal returns local rows and only counts the others", () => {
  const rows = [{ h: "local" }, { h: "ssh-1" }, { h: "" }, {}, { h: "ssh-1" }];
  const r = keepLocal(rows, (x: { h?: string }) => x.h, { omittedHostIds: ["ssh-2"], truncated: true });
  assert.deepEqual(r, {
    rows: [{ h: "local" }],
    nonLocal: { rows: 4, hostIds: ["(none)", "ssh-1"] },
    omittedHostIds: ["ssh-2"],
    truncated: true,
  });
});

test("worktree list through the adapter drops non-local rows", async () => {
  const orca = createOrcaAdapter(createFakeOrca({ scenario: "remote-host" }).exec);
  const r = await orca.worktreeList({});
  assert.ok(r.ok);
  assert.deepEqual(
    r.value.rows.map((w) => w.path),
    ["/home/dev/src/api"],
  );
  assert.deepEqual(r.value.nonLocal, { rows: 3, hostIds: ["(none)", "ssh-0000000000001-aaaaaa"] });
  assert.deepEqual(r.value.omittedHostIds, ["ssh-0000000000002-bbbbbb"]);
});

test("worker-list rows are filtered on their host field", async () => {
  const fake = createFakeOrca({ scenario: "remote-host" });
  const r = await createOrcaAdapter(fake.exec).workerList({});
  assert.ok(r.ok);
  assert.deepEqual(
    r.value.rows.map((w) => w.dispatchId),
    ["ctx_000000000001"],
  );
  assert.equal(r.value.nonLocal.rows, 2);
  assert.ok(!(fake.calls[0] ?? []).includes("--include-remote"));
});

test("worktree ps keeps the recorded local rows", async () => {
  const r = await createOrcaAdapter(createFakeOrca().exec).worktreePs({ agentWait: true });
  assert.ok(r.ok);
  assert.equal(r.value.rows.length, 1);
  assert.equal(r.value.nonLocal.rows, 0);
});
