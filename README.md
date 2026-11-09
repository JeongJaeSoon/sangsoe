# sangsoe

Orchestration for Claude Code sessions on Orca. Work in progress: pre-releases (`v0.1.0-rc.N`) only.

## Install

macOS with Homebrew, Claude Code, Orca and an authenticated `gh`. Run these in order.

1. `brew install JeongJaeSoon/tap/sangsoe`, then `sangsoe --version`. It prints `sangsoe <version>`, for example `sangsoe 0.1.0-rc.4`.
2. `sangsoe install` registers the Claude Code plugin and the Orca plugin, then runs `sangsoe doctor`. It is safe to re-run. On a first install it prints:

   ```
   claude: added marketplace sangsoe → /opt/homebrew/opt/sangsoe/libexec
   claude: installed sangsoe@sangsoe
   orca: loaded, approval waits — fingerprint ap1-…; next: sangsoe plugin approve
   ```

   In the doctor rows that follow, `FAIL orca plugin: local.sangsoe waits for approval` is expected, and `warn orca-plugin-version` may appear with it. Both name `sangsoe plugin approve` as the fix. Every other row should be `ok`; a `notice` row names a command to run.
3. `sangsoe plugin approve` enables the Orca plugin only when three things hold:
   - the build's pull request has an independent review with no Act-on findings, recorded on this machine with `sangsoe review record --pr <n> --head <full 40-character sha> --act-on 0 --reviewer <name>`;
   - the installed folder's content equals both the build commit and the reviewed head;
   - Orca asks for exactly `local.sangsoe` at this folder.

   Run `sangsoe plugin approve --dry-run` first. It prints each check and the `orca plugin enable` command without running it. When the review is not recorded yet, its `FAIL merged_with_clean_review: no review evidence for PR #<n> head <sha>` line names the PR and head to pass to `sangsoe review record`. On success approve prints `recorded plugin_approved (seq N)` and `enabled`.
4. `sangsoe doctor` now prints `ok` on every row and exits 0. That includes `orca plugin: local.sangsoe <version>, running` and `orca-plugin-content: 내용 … = 빌드 커밋 … = 리뷰된 head …`. The one exception is the `reaper-config` row, described next.

**REAPER.** REAPER, the Orca plugin's cleanup round, removes nothing until `~/.config/sangsoe/config.json` has a `reaper` section: without it each round only marks and records no candidates. Until then doctor prints `notice   reaper-config: REAPER 는 표시만 하고 정리하지 않는다 …` and still exits 0. With the section, REAPER removes a card that is finished (its pull request merged or closed with the card's HEAD on it, or, with no pull request, every Dispatch run in it settled and the last one succeeded or was cancelled), unreachable from every root for two rounds and past the grace, and only when its work is committed and pushed. It removes the card's worktree and branch, then the Docker containers, volumes, networks and images recorded for that card. To turn it on, add this to the file, listing the cards to keep by instance id, path or branch:

```json
{ "reaper": { "protect": [] } }
```

Optional `grace_minutes` (default 30) and `min_gap_minutes` (default 10, the floor the grace shrinks to while the machine is under load) sit beside `protect`. Doctor then prints `ok       reaper-config: REAPER 정리 켜짐: 보호 0개, 유예 30분`. `sangsoe install` never writes this section.

Open a new Claude Code session to pick up the plugin.

`sangsoe install` registers with the Claude Code configuration directory it runs under: `CLAUDE_CONFIG_DIR` when that is set, otherwise `~/.claude`. Registration is per directory. Run `sangsoe install` from your own shell to register into `~/.claude`. A session started with another `CLAUDE_CONFIG_DIR` (an Orca profile, for example) needs its own `sangsoe install`. Homebrew itself writes nothing to your home directory.

## Update

Every `brew upgrade sangsoe` needs a new review record and a new approval. Each version installs to its own Homebrew Cellar folder, and Orca ties an approval to that folder, so nothing in the new version runs in Orca until `sangsoe plugin approve` passes for it.

1. `brew upgrade sangsoe`, then `sangsoe --version` prints the new version.
2. `sangsoe install`. It prints `orca: loaded, approval waits — fingerprint ap1-…; next: sangsoe plugin approve`. Its doctor rows now include:

   ```
   FAIL     orca plugin: local.sangsoe waits for approval — fix: sangsoe plugin approve
   ```

   and `warn orca-plugin-version` may appear with the same fix. Every other row should be `ok`, `orca-plugin-content` included: the new folder equals its build commit and reviewed head before anything is enabled.
3. Whoever reviewed the new build's pull request records it on this machine: `sangsoe review record --pr <n> --head <full sha> --act-on 0 --reviewer <name>`. The previous version's record does not carry over: it names another pull request and head.
4. `sangsoe plugin approve --dry-run`, then `sangsoe plugin approve`. It prints `recorded plugin_approved (seq N)` and `enabled`.
5. `sangsoe doctor` prints `ok` on every row and exits 0, with `orca plugin: local.sangsoe <new version>, running` (and the `reaper-config` notice while no `reaper` section is set).

The approval covers the core the Orca plugin runs. A release packs a copy of `core/` into `orca-plugin/vendor/`, the plugin loads only that copy, and approve and doctor compare the whole folder, the copy included, with the reviewed source. A changed file anywhere in the installed folder turns `orca-plugin-content` into `FAIL`, with `sangsoe plugin approve` as the fix.

Reinstalling the same version (`brew reinstall sangsoe`, then `sangsoe install`) needs no new approval. `sangsoe install` prints `orca: loaded /opt/homebrew/opt/sangsoe/libexec/orca-plugin`, and doctor is all `ok`.

## Uninstall

Run `sangsoe uninstall` first. It prints `claude: uninstalled sangsoe@sangsoe`, `claude: removed marketplace sangsoe`, `orca: unloaded local.sangsoe` and ``kept: ~/.local/share/sangsoe (data) and ~/.config/sangsoe (settings); `brew uninstall sangsoe` removes the tree``. A registration that is already gone prints `was not installed`, `was not added` or `no sangsoe development plugin loaded` instead, and is not an error. Then run `brew uninstall sangsoe`. Neither deletes `~/.local/share/sangsoe` (data) or `~/.config/sangsoe` (settings). `brew uninstall` also removes `node` if `node` was only installed for sangsoe.

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

A V3 change or one touching `protected_paths` still waits for the owner's approval. Anything land cannot read refuses the merge. `sangsoe land --dry-run` prints the path it would take without merging. Without the key, land behaves as before. See `docs/decisions-impl/0158-verdict-approval-merge.md`.

## Layout

One repository, four slots (see `docs/architecture.md` for the full map):

| Directory | Slot | Tokens |
|---|---|---|
| `core/`, `cli/` | Shared TS core, sqlite, shell-only CLI | none |
| `orca-plugin/` | Orca plugin: monitors, REAPER timer, panel | none |
| `claude-plugin/` | Claude Code plugin: `hooks/` and `mcp/` (no tokens), `skills/` and `agents/` (token-using) | mixed |

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
