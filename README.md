# sangsoe

Orchestration for Claude Code sessions on Orca. Work in progress; install instructions will follow.

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
