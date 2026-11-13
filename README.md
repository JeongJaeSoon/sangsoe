# sangsoe

Orchestration for Claude Code sessions on Orca. The current stable release is `v0.1.6`; what changed is in `CHANGELOG.md`.

## Install

macOS with Homebrew, Claude Code, Orca and an authenticated `gh`. Run these in order, in a terminal or each on a Claude Code `!` line (step 3 says what changes there).

1. `brew install JeongJaeSoon/tap/sangsoe`, then `sangsoe --version`. It prints `sangsoe <version>`, for example `sangsoe 0.1.6`. With the pre-release formula `sangsoe-rc` installed, run Uninstall first: the install refuses while `sangsoe-rc` is there.
2. `sangsoe install` registers and enables the Claude Code plugin, registers the Orca plugin, then runs `sangsoe doctor`. It is safe to re-run. On a first install it prints:

   ```
   claude: added marketplace sangsoe → /opt/homebrew/opt/sangsoe/libexec
   claude: installed sangsoe@sangsoe
   claude: Orca starts new sessions with this profile (/Users/<you>/.claude)
   orca: loaded, approval waits — fingerprint ap1-…; next: sangsoe plugin approve
   ```

   When the plugin was installed but disabled, install also prints `claude: enabled sangsoe@sangsoe`. The third line differs when Orca starts sessions with another Claude profile (see below).

   In the doctor rows that follow, `FAIL orca plugin: local.sangsoe waits for approval` is expected, and `warn orca-plugin-version` may appear with it. Both name `sangsoe plugin approve` as the fix. `warn permissions: 0 of 16 sangsoe rules present in …` is expected too, with `sangsoe install --permissions` as the fix (the next step). Every other row should be `ok`; a `notice` row names a command to run.
3. `sangsoe install --permissions` adds the `permissions.allow` rules sangsoe's own sessions need, so a worker or lead does not stop on a permission prompt: one rule for sangsoe's MCP tools (`mcp__plugin_sangsoe_sangsoe`) and one per Orca command the sessions run (`Bash(orca orchestration ask:*)`, `Bash(orca worktree set:*)`, `Bash(orca search:*)` and the like; decision 221 lists each with the file that calls it). No rule allows `git push`, `gh pr merge`, `rm` or `brew`. It writes the `settings.json` of the Claude profile it runs under and of the one Orca starts sessions with, when that is another directory. It prints a unified diff and asks `Add these 16 rules? [y/N]` (32 when it writes two profiles); only `y` writes, and a file that changed while the question was open is left as it is. The write replaces the file in one step, keeps a copy of the old file as `settings.json.sangsoe-backup`, and changes nothing else in it: other rules, key order and indentation stay as they were. It prints `permissions: added 16 rules to <dir>/settings.json (backup …)`. Run again, it prints `already has all 16 sangsoe rules; nothing to write` and asks nothing. A `settings.json` that is not valid JSON is refused with `is not valid JSON (…); nothing written`. `--scope project` writes `.claude/settings.json` of the current directory instead, `--scope local` its `.claude/settings.local.json`. A Claude Code `!` line has no terminal to answer the question on: there it prints the same diff, writes nothing, exits 1 and ends with `permissions: no terminal to ask on, so nothing was written. Read the diff above, then run: sangsoe install --permissions --yes` (with the same `--scope` when one was given). Read the diff, then run that line on the next `!` line; `--yes` adds the missing rules without asking, the same diff unless the file changed in between. sangsoe records which rules it added in `~/.local/share/sangsoe/permissions.json`; `sangsoe uninstall` removes those rules, and only those, where they are still present as written.
4. `sangsoe plugin approve` enables the Orca plugin only when three things hold:
   - the build's pull request has an independent review with no Act-on findings, recorded on this machine with `sangsoe review record --pr <n> --head <full 40-character sha> --act-on 0 --reviewer <name>`;
   - the installed folder's content equals both the build commit and the reviewed head;
   - Orca asks for exactly `local.sangsoe` at this folder.

   Run `sangsoe plugin approve --dry-run` first. It prints each check and the `orca plugin enable` command without running it. When the review is not recorded yet, its `FAIL merged_with_clean_review: no review evidence for PR #<n> head <sha>` line names the PR and head to pass to `sangsoe review record`. On success approve prints `recorded plugin_approved (seq N)` and `enabled`.
5. `sangsoe doctor` now prints `ok` on every row and exits 0. That includes `orca plugin: local.sangsoe <version>, running`, `permissions: 16 of 16 sangsoe rules present in <dir>/settings.json` (which also covers `sangsoe land`) and `orca-plugin-content: 내용 … = 빌드 커밋 … = 리뷰된 head …`. The exceptions are `notice` rows, which name a setting or command and do not change the exit code. On a fresh machine expect `reaper-config` and `watch-repos`, described next, `tier-config` (see Land), and often `model-table` (alias pins, a Claude Code newer than the model table, or `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` in the environment). `model-table` is a `warn`, which does not change the exit code either, when a repository Orca lists commits `.claude/settings.local.json` and your Claude Code settings give no advisor model or `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` is set.

**REAPER.** REAPER, the Orca plugin's cleanup round, removes nothing until `~/.config/sangsoe/config.json` has a `reaper` section: without it each round only marks and records no candidates. Until then doctor prints `notice   reaper-config: REAPER 는 표시만 하고 정리하지 않는다 …` and still exits 0. With the section, REAPER removes a card that is finished (its pull request merged or closed with the card's HEAD on it, or, with no pull request, every Dispatch run in it settled and the last one succeeded or was cancelled), unreachable from every root for two rounds and past the grace, and only when its work is committed and pushed. It removes the card's worktree and branch, then the Docker containers, volumes, networks and images recorded for that card. To turn it on, add this to the file, listing the cards to keep by instance id, path or branch:

```json
{ "reaper": { "protect": [] } }
```

Optional `grace_minutes` (default 30) and `min_gap_minutes` (default 10, the floor the grace shrinks to while the machine is under load) sit beside `protect`. Doctor then prints `ok       reaper-config: REAPER 정리 켜짐: 보호 0개, 유예 30분`. `sangsoe install` never writes this section.

**Resources and cleanup.** The panel's last section, 리소스, is folded until you open it, and it stays as you left it. Opened or refreshed, it reads the machine's load (CPU per core, free memory and disk, and the resource monitor's last high-load notice), what sangsoe made (its worktrees and their size, their live terminals, claude and node processes, leftover temporary folders in `$TMPDIR`) and what cleanup would take. It reads nothing on a timer and keeps none of what it read. 정리… first lists every target; only the second button runs. Only worktrees sangsoe started are offered; another program's are never listed or removed. They go through the same REAPER checks as its own rounds, minus the two-round wait: one with uncommitted or unpushed work, an open pull request, an open Task or a live session stays, and nothing is removed without the `reaper` section above. A card with no pull request and no Dispatch, or one whose folder is already gone, goes only this way. Temporary folders older than an hour go to the trash (`/usr/bin/trash`; without it they stay). Processes are shown, never stopped. From a terminal, `sangsoe reap plan` prints the same reading, and `sangsoe reap run --only <id,...>` or `--tmp` runs the same cleanup on what you name.

**Watched repositories.** The pr monitor reads pull requests only from the repositories in `watch.repos`. Until that list has one, doctor prints `notice   watch-repos: pr monitor 가 아무 저장소도 보지 않는다 …` and still exits 0. Add the repositories to the same file, then doctor prints `ok       watch-repos: pr monitor 가 저장소 1개를 본다`. `sangsoe install` never writes this setting.

```json
{ "watch": { "repos": ["acme/api"] } }
```

**Load thresholds.** While the machine is at `warn` or `danger`, the pressure gate holds a heavy start (`start_unit`, `docker compose up`, `orca worktree create`) and names the metric that binds first, with its value and threshold, for example `디스크 여유 8 GB ≤ 위험 10 GB`. The same thresholds judge the resource monitor, REAPER and a Run's free slots. Each metric is a `[warn, danger]` pair; the defaults are below (decision 210). The `capacity` key is optional and each entry overrides only its metric. A malformed entry keeps the default: a free amount needs warn above danger, load per CPU needs warn below danger, both as numbers 0 or more.

```json
{ "capacity": { "disk_free_gb": [20, 10], "load_per_cpu": [1.3, 2.0], "mem_free_pct": [20, 10] } }
```

Open a new Claude Code session to pick up the plugin.

**Claude profiles.** Claude Code keeps its plugins per configuration directory: `CLAUDE_CONFIG_DIR` when that is set, otherwise `~/.claude`. `sangsoe install` registers into the directory it runs under, and also into the one Orca starts new Claude sessions with, which it reads from `orca account list --json`. When that is another directory, install repeats its `claude` lines for it as `claude (Orca profile <dir>): …`. Doctor prints the directory it checked as `ok       claude profile: checked <dir> (…)`, and the Orca one as an `orca claude profile` row: `ok` when Orca uses the checked directory or the plugin is enabled at this version there, otherwise `warn` with `sangsoe install` as the fix (or `orca open` when Orca's answer cannot be read). `sangsoe uninstall` removes the registration from both directories. Homebrew itself writes nothing to your home directory.

## Update

Every `brew upgrade sangsoe` needs a new review record and a new approval. Each version installs to its own Homebrew Cellar folder, and Orca ties an approval to that folder, so nothing in the new version runs in Orca until `sangsoe plugin approve` passes for it.

1. `brew upgrade sangsoe`, then `sangsoe --version` prints the new version.
2. `sangsoe install`. It prints `orca: loaded, approval waits — fingerprint ap1-…; next: sangsoe plugin approve`. Its doctor rows now include:

   ```
   FAIL     orca plugin: local.sangsoe waits for approval — fix: sangsoe plugin approve
   ```

   and `warn orca-plugin-version` may appear with the same fix. Every other row should be `ok`, `orca-plugin-content` included: the new folder equals its build commit and reviewed head before anything is enabled. That row downloads both trees with `gh`; when GitHub authentication fails it is a one-line `notice` that the content could not be compared, which is not a sangsoe defect: run `gh auth status`, sign in to GitHub again, then `sangsoe doctor`.
3. Whoever reviewed the new build's pull request records it on this machine: `sangsoe review record --pr <n> --head <full sha> --act-on 0 --reviewer <name>`. The previous version's record does not carry over: it names another pull request and head.
4. `sangsoe plugin approve --dry-run`, then `sangsoe plugin approve`. It prints `recorded plugin_approved (seq N)` and `enabled`.
5. `sangsoe doctor` exits 0 with every row `ok` or `notice`, including `orca plugin: local.sangsoe <new version>, running`. A `notice` row does not change the exit code; the usual ones are those step 5 of Install names. When a release needs a new rule, `permissions` is a `warn` naming `sangsoe install --permissions`, which adds only the missing rules.

A Claude Code session that was running during `brew upgrade sangsoe` keeps working: a tool call made while the plugin folder is missing goes ahead with a `PreToolUse` hook error instead of being held. Open a new session to pick up the new plugin. A session started under `0.1.1` or older still has the hook that holds such a call; restart it.

Restart every session that calls `start_unit` after an upgrade: quit it and start it again in the same directory with `claude --continue` plus the flags it was started with (such as `--agent`), which starts a new MCP server and keeps the conversation. `/reload-plugins` keeps a plugin MCP server whose configuration is unchanged, and an upgrade at the same install path changes none of it, so the server keeps the code it loaded at start and the old model table and start rules stay in force. From the release after `0.1.3`, `start_unit` refuses on such a server with `server_stale`, names both versions and names this recovery. A server started under an older release has no such check.

Upgrading from `0.1.0` adds the `permissions` row and changes others; `CHANGELOG.md` lists them, and what upgrading from an older release adds.

The approval covers the core the Orca plugin runs. A release packs a copy of `core/` into `orca-plugin/vendor/`, the plugin loads only that copy, and approve and doctor compare the whole folder, the copy included, with the reviewed source. A changed file anywhere in the installed folder turns `orca-plugin-content` into `FAIL`, with `sangsoe plugin approve` as the fix. This holds for a release only: when the plugin folder sits in a git checkout, the worker falls back to the checkout's `../core`, which the approval's dirty check does not cover.

Reinstalling the same version (`brew reinstall sangsoe`, then `sangsoe install`) needs no new approval. `sangsoe install` prints `orca: loaded /opt/homebrew/opt/sangsoe/libexec/orca-plugin`, and doctor is all `ok` apart from those notices.

## Uninstall

Run `sangsoe uninstall` before `brew uninstall sangsoe`: once the tree is gone, the `sangsoe` command that removes the registrations is gone with it. Uninstall prints `claude: uninstalled sangsoe@sangsoe`, `claude: removed marketplace sangsoe`, ``claude: restart every running Claude Code session that loaded sangsoe@sangsoe; until then it keeps the plugin's hooks``, `orca: unloaded local.sangsoe`, `permissions: removed N rules sangsoe added from <dir>/settings.json` (one line per file `sangsoe install --permissions` wrote) and ``kept: ~/.local/share/sangsoe (data) and ~/.config/sangsoe (settings); `brew uninstall sangsoe` removes the tree``. It removes the marketplace from every scope Claude Code lists it in. A registration that is already gone prints `was not installed`, `was not added` or `no sangsoe development plugin loaded` instead, and is not an error; with no recorded rules the permissions line is `permissions: sangsoe added no permission rules`. Only rules still present as written are removed. Because uninstall drops those rules, switching from a pre-release to the stable release through `sangsoe uninstall` needs `sangsoe install --permissions` again after the next `sangsoe install`. Then run `brew uninstall sangsoe`, or `brew uninstall sangsoe-rc` when the pre-release formula is installed: `sangsoe` declares a conflict with `sangsoe-rc`, so `brew install JeongJaeSoon/tap/sangsoe` refuses while `sangsoe-rc` is still installed. Neither `sangsoe uninstall` nor `brew uninstall` deletes `~/.local/share/sangsoe` (data) or `~/.config/sangsoe` (settings). `brew uninstall` also removes `node` if `node` was only installed for sangsoe.

**Running sessions.** A Claude Code session keeps the hooks it loaded at start, so uninstalling does not take sangsoe's hooks out of a session that is already running. After `brew uninstall sangsoe` such a session still runs its tools, but each call shows a `PreToolUse` hook error and the sangsoe gates no longer check it. Restart those sessions.

## Land

`sangsoe land --pr <n> [--repo <owner/name>] [--dry-run]` is the only way sangsoe merges a pull request. It schedules `gh pr merge --auto` when the repository's settings enforce review and CI (decision 81), and otherwise records `merge_on_approval` and merges once someone other than the author approves on GitHub.

On a repository with a single GitHub account, nobody but the author can approve, so that approval never comes. Such a repository can opt in to counting a recorded independent review instead. Add it to `~/.config/sangsoe/config.json`:

```json
{
  "verdict_merge_repos": ["acme/api"]
}
```

For a listed repository, land merges at once (`gh pr merge --squash --match-head-commit <head>`, or the first method the repository allows) when all of these hold at the pull request's current head:

- a verdict recorded with `sangsoe review record --pr <n> --head <head> --act-on 0 --reviewer <name>` at exactly that head, by a reviewer who is not the author;
- the evidence the change's tier requires (decision 85);
- every required check passed, or every check when GitHub reports none as required, and at least one check ran;
- no unresolved review thread, and GitHub calls the pull request mergeable.

A V3 change or one touching `protected_paths` still waits for the owner's approval. Anything land cannot read refuses the merge. `sangsoe land --dry-run` prints the path it would take without merging. Without the key, land behaves as before. See decision 158 in `docs/decisions.md`.

**Verify tier.** Land asks for the evidence of the pull request's tier (V0 to V3), computed from its diff and these lists in `~/.config/sangsoe/config.json`. All five lists must be there; with any one missing, every pull request is V3, `sangsoe verify-tier` prints `tier_source: none (fail-closed V3): …` naming the missing lists, and doctor prints a `tier-config` notice (decision 172):

```json
{
  "protected_paths": ["infra/"],
  "verify_tier": { "docs_globs": ["docs/"], "test_globs": ["test/"], "ui_globs": [], "v3_globs": [".github/", "package-lock.json"] }
}
```

**Evidence.** Someone other than the pull request's author records each run at the current head: `sangsoe evidence record --pr <n> --head <head> --kind test|run|ui|dev --exit-code <n> --not-verified <what> --recorder <name>` (agents use the `evidence_record` tool). After the merge, `sangsoe stage record --pr <n> --stage merge|dev|prod --sha <sha> --recorder <name>` (the `stage_record` tool) records each stage a flow's deploy steps wait on. See decision 171. Under Claude Code (a session or a `!` line), `sangsoe evidence record`, `sangsoe stage record` and `sangsoe review record` refuse with `recorder_is_author` when run from a checkout on the pull request's branch or head, so the session that wrote the pull request cannot record its own review, evidence or stages; the lead or the owner records them from another folder (decision 227).

## Layout

One repository, four slots (see `docs/architecture.md` for the full map):

| Directory | Slot | Tokens |
|---|---|---|
| `core/`, `cli/` | Shared TS core, sqlite, shell-only CLI | none |
| `orca-plugin/` | Orca plugin: monitors, REAPER timer, panel | none |
| `claude-plugin/` | Claude Code plugin: `hooks/` and `mcp/` (no tokens), `skills/` and `agents/` (token-using) | mixed |

The Orca plugin's manifest (`orca-plugin/orca-plugin.json`) declares two read capabilities, `workspace:read` and `agent:read`, and `storage:own`, where the panel keeps whether its 리소스 section is open (decision 234). The worker also runs two writes that the declaration does not name: `orca terminal create` for the panel's open command (`orca-plugin/panel/requests.ts:54`), and `orca worktree rm` in REAPER rounds (`core/reaper/round.ts`, decision 86). The manifest is not yet changed to match them.

Orca CLI built-ins are called, not rebuilt. The design spec lives in `docs/` (`design.html` is the entry point).

## Development

Requires Node.js 24.15 or later (its bundled SQLite is the first to pass the store's version check). From a fresh clone:

```sh
npm ci
npm run build
node dist/cli/main.js --version
```

Checks (the same commands CI runs as jobs `typecheck`, `lint`, `unit`):

```sh
npm run typecheck
npm run lint
npm test
```
