# sangsoe

Orchestration for Claude Code sessions on Orca. Work in progress: pre-releases (`v0.1.0-rc.N`) only.

## Install

macOS with Homebrew, Claude Code and Orca:

```sh
brew install JeongJaeSoon/tap/sangsoe
sangsoe install      # registers the Claude Code plugin and the Orca plugin; safe to re-run
sangsoe doctor       # ok / FAIL (with the fix) / not yet, per item
```

When `sangsoe install` reports that the Orca plugin waits for approval, run `sangsoe plugin approve`. Open a new Claude Code session to pick up the plugin.

Update: `brew upgrade sangsoe && sangsoe install`.
Remove: `sangsoe uninstall`, then `brew uninstall sangsoe`. Neither deletes `~/.local/share/sangsoe` (data) or `~/.config/sangsoe` (settings).

`sangsoe install` registers with the Claude Code configuration it runs under (`CLAUDE_CONFIG_DIR`, or `~/.claude`). Homebrew itself writes nothing to your home directory.

## Layout

One repository, four slots (see `docs/architecture.md` for the full map):

| Directory | Slot | Tokens |
|---|---|---|
| `core/`, `cli/` | Shared TS core, sqlite, shell-only CLI | none |
| `orca-plugin/` | Orca plugin: monitors, REAPER timer, panel | none |
| `claude-plugin/` | Claude Code plugin: `hooks/` and `mcp/` (no tokens), `skills/` and `agents/` (token-using) | mixed |

Orca CLI built-ins are called, not rebuilt. The design spec lives in `docs/` (`design.html` is the entry point).

## Development

Requires Node.js 24.2 or later. From a fresh clone:

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
