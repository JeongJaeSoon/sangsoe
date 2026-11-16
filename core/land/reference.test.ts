import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrcaAdapter, WorktreeRow } from "../contract/orca.ts";
import { cardReference } from "./reference.ts";

const URL = "https://github.com/acme/api/pull/12";
const ask = { repo: "acme/api", pr: 12, headRef: "feature-12" };

function card(extra: Partial<WorktreeRow> & { linkedItems?: { url: string }[] } = {}) {
  return { id: "repo1::/w/12", repoId: "repo1", projectId: "github:acme/api", path: "/w/12", branch: "refs/heads/feature-12", displayName: "card 12", isMainWorktree: false, isArchived: false, ...extra };
}

function world(show: unknown, add: unknown = { ok: true, value: {} }) {
  const calls: string[] = [];
  const orca = {
    worktreeShow: async (a: { worktree: string }) => {
      calls.push(`show ${a.worktree}`);
      return show;
    },
    referenceAdd: async (a: { worktree: string; urls: string[] }) => {
      calls.push(`add ${a.urls.join(" ")} ${a.worktree}`);
      return add;
    },
  } as unknown as OrcaAdapter;
  return { calls, port: cardReference(orca) };
}

test("a card on the PR's head branch without the PR gets it, found by branch and added by id", async () => {
  const w = world({ ok: true, value: card({ linkedItems: [{ url: "https://linear.app/acme/issue/ACME-1" }] }) });
  assert.equal(await w.port(ask), null);
  assert.deepEqual(w.calls, ["show branch:feature-12", `add ${URL} id:repo1::/w/12`]);
});

test("a card that already lists the PR is left alone", async () => {
  const w = world({ ok: true, value: card({ linkedItems: [{ url: URL }] }) });
  assert.equal(await w.port(ask), null);
  assert.deepEqual(w.calls, ["show branch:feature-12"]);
});

test("no card on the branch: one note line with Orca's code, nothing added", async () => {
  const w = world({ ok: false, error: { code: "selector_not_found", message: "no worktree" } });
  const note = await w.port(ask);
  assert.match(note ?? "", /^card reference: not attached .*selector_not_found/);
  assert.deepEqual(w.calls, ["show branch:feature-12"]);
});

test("a card of another project on the same branch name is not touched", async () => {
  const w = world({ ok: true, value: card({ projectId: "github:acme/web" }) });
  assert.match((await w.port(ask)) ?? "", /^card reference: not attached .*acme\/web/);
  assert.deepEqual(w.calls, ["show branch:feature-12"]);
});

test("an add Orca refuses becomes a note", async () => {
  const w = world({ ok: true, value: card() }, { ok: false, error: { code: "invalid_argument", message: "bad url" } });
  assert.match((await w.port(ask)) ?? "", /^card reference: not attached .*invalid_argument/);
});
