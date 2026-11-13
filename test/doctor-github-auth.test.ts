import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { CheckResult, PluginBuild } from "../core/checks/index.ts";
import { orcaPluginContent } from "../core/checks/orca-plugin-content.ts";
import type { RunResult } from "../core/install/host.ts";
import { realPluginBuild } from "../core/install/doctor.ts";
import { createOrcaAdapter } from "../core/orca/adapter.ts";
import { createFakeOrca } from "./fake-orca/index.ts";

// Decision 233: the real tree fetch runs a `gh` found on PATH; this one prints the stderr file next to it and fails.
const bin = mkdtempSync(join(tmpdir(), "sangsoe-fake-gh-"));
writeFileSync(join(bin, "gh"), '#!/bin/sh\ncat "$(dirname "$0")/stderr" >&2\nexit 1\n');
chmodSync(join(bin, "gh"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
after(() => rmSync(bin, { recursive: true, force: true }));

const BUILT = "b".repeat(40);
const notCheckout = async (): Promise<RunResult> => ({ code: 1, stdout: "", stderr: "" });

async function contentRow(stderr: string): Promise<CheckResult> {
  writeFileSync(join(bin, "stderr"), stderr);
  const fake = createFakeOrca({
    scenario: "local",
    replies: { "plugin-inspect": () => ({ code: 0, stdout: JSON.stringify({ ok: true, result: { contentHash: "sha256-here" } }), stderr: "" }) },
  });
  const pluginBuild: PluginBuild = { ...realPluginBuild("/opt/homebrew/opt/sangsoe/libexec", notCheckout), buildCommit: async () => BUILT };
  return orcaPluginContent.run({ orca: createOrcaAdapter(fake.exec), exec: fake.exec, coreVersion: "0.1.0", pluginBuild });
}

function assertAuthNotice(r: CheckResult): void {
  assert.equal(r.status, "notice", r.summary);
  assert.match(r.summary, /GitHub 인증이 실패/);
  assert.match(r.summary, /sangsoe 결함이 아니다/);
  assert.doesNotMatch(r.summary, /[\n\r\x1b]|Command failed/, "one clean line, no raw stderr");
  assert.match(r.fix ?? "", /^gh auth status, re-authenticate GitHub/);
}

test("decision 233: gh's 401 on the tree fetch is a one-line notice, not a sangsoe warning", async () => {
  assertAuthNotice(await contentRow('gh: Bad credentials (HTTP 401)\r\n{\r\n  "message": "Bad credentials",\r\n  "status": "401"\r\n}\n'));
});

test("decision 233: a credential helper's coloured multi-line refusal is the same notice", async () => {
  assertAuthNotice(await contentRow("\x1b[31mERROR\x1b[0m could not get a GitHub token\n\x1b[2m  the access token expired\x1b[0m\n"));
});

test("decision 233: fetch failures that are not a failed login keep their warning", async () => {
  const notAuth = [
    'gh: Not Found (HTTP 404)\n{"message":"Not Found"}\n',
    "gh: API rate limit exceeded for 203.0.113.7. (But here's the good news: Authenticated requests get a higher rate limit.) (HTTP 403)\n",
    "",
  ];
  for (const stderr of notAuth) {
    const r = await contentRow(stderr);
    assert.equal(r.status, "warn", JSON.stringify(stderr));
    assert.match(r.summary, /트리를 받지 못했다/);
  }
});
