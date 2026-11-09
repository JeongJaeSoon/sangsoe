# sangsoe

Orchestration for Claude Code sessions on Orca. Work in progress: pre-releases (`v0.1.0-rc.N`) only.

## Install

macOS with Homebrew, Claude Code, Orca and an authenticated `gh`. Run these in order.

1. `brew install JeongJaeSoon/tap/sangsoe`, then `sangsoe --version`. It prints `sangsoe <version>`, for example `sangsoe 0.1.0-rc.3`.
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
4. `sangsoe doctor` now prints `ok` on every row and exits 0. That includes `orca plugin: local.sangsoe <version>, running` and `orca-plugin-content: 내용 … = 빌드 커밋 … = 리뷰된 head …`.

Open a new Claude Code session to pick up the plugin.

`sangsoe install` registers with the Claude Code configuration directory it runs under: `CLAUDE_CONFIG_DIR` when that is set, otherwise `~/.claude`. Registration is per directory. Run `sangsoe install` from your own shell to register into `~/.claude`. A session started with another `CLAUDE_CONFIG_DIR` (an Orca profile, for example) needs its own `sangsoe install`. Homebrew itself writes nothing to your home directory.

**Update.** Run `brew upgrade sangsoe`, then `sangsoe install`, then steps 3 and 4 again: the new build comes from a new pull request, so its review is recorded with `sangsoe review record` before `sangsoe plugin approve` passes. Each version installs to its own Homebrew Cellar folder, and Orca ties the approval to that folder. So after an upgrade, doctor shows the plugin waiting for approval again until approve runs.

**Remove.** Run `sangsoe uninstall` first. It prints `claude: uninstalled sangsoe@sangsoe`, `claude: removed marketplace sangsoe` and `orca: unloaded local.sangsoe`. Then run `brew uninstall sangsoe`. Neither deletes `~/.local/share/sangsoe` (data) or `~/.config/sangsoe` (settings). `brew uninstall` also removes `node` if `node` was only installed for sangsoe.

**Reinstall.** Reinstalling the same version (`brew install JeongJaeSoon/tap/sangsoe`, then `sangsoe install`) needs no new approval. `sangsoe install` prints `orca: loaded /opt/homebrew/opt/sangsoe/libexec/orca-plugin`, and doctor is all `ok`.

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
