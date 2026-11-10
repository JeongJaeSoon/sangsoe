# Changelog

Decision numbers refer to `docs/decisions.md`.

## 0.1.0 (stable)

The first stable release. It carries everything since `v0.1.0-rc.4`.

### Upgrading from 0.1.0-rc.4

- **Re-approve.** `brew upgrade sangsoe` installs to a new Cellar folder, so the Orca plugin waits for approval again. Record the review of the 0.1.0 build with `sangsoe review record`, then run `sangsoe plugin approve`, as the README's Update section says.
- **Facts backup.** The first time 0.1.0 opens the database it writes `~/.local/share/sangsoe/sangsoe.db.facts.jsonl`, a copy of the rows only sangsoe owns, including the ones rc.4 wrote (decisions 183, 192). Nothing to do; `store-restore` names the file.
- **Doctor rows that change.**
  - New rows: `claude profile` (the Claude configuration directory doctor checked), `orca claude profile` (the one Orca starts sessions with), `tier-config`, `watch-repos`, `model-table` and `store-restore`.
  - `tier-config` and `watch-repos` print a `notice` until `~/.config/sangsoe/config.json` has those settings. `model-table` prints a `notice` when Claude Code settings pin model aliases. A `notice` row does not change the exit code.
  - The `claude` row no longer appends `CLAUDE_CONFIG_DIR`; the `claude profile` row says which directory was checked.
  - `claude-plugin-version` is `ok` after `sangsoe install`, which now enables the Claude Code plugin (decision 166).

### Install and doctor

- `sangsoe install` enables the Claude Code plugin it installs (166), also registers it in the Claude profile Orca starts sessions with (167), and doctor notices an empty `watch.repos` (168).
- Doctor reports a stale model table or alias pins without spending tokens (165), and the facts backup (`store-restore`).
- The release smoke expands both bundled flow templates from the packed tarball; the build ships the templates in `dist/`.

### Models

- One model-selection table, `core/models/table.ts`, read by every place that picks a model (164); advisor pairing for implementation workers (187); subagents always name their model tier (188).

### Panel and status bar

- The panel follows Orca's own panel layout (169); the status bar item reads `✨ SANGSOE  🚧 0 · 결정 0 · 🔄 0` (170). Answered and verified states show their labels, not raw state names.

### Land, graph and decisions

- One recording entrance each for `evidence` and `stage_recorded` (171); land, tier and model rules narrowed (172).
- A dependent waits for its predecessor's PR to merge, and a PR closed unmerged is not done (175, 178).
- A verdict with a different Act-on count is a new row (179, narrows 111); decisions close on the owner's answer, to-dos on verification (181).
- The chat hook links only an orchestrator's `dNNN` line as an answer (173).

### Monitors, REAPER and the store

- A REAPER round with no `reaper` setting only marks, and records `mark_only` (174).
- While Orca is closed sangsoe does nothing; the first REAPER round after it reopens catches up once (182).
- A lost database is rebuilt from Orca and GitHub plus the facts backup (183, 184); long-lived connections check that their file is still the one they opened, and the plugin worker reopens (191).
- `job_drift` compares the installed Orca plugin's version and state; content is `orca-plugin-content`'s (185, amends 149).
- SessionStart reports `worker_stuck{no_role_line}` only for Tasks sangsoe created (192).

### Documentation

- LaunchAgents, launchd jobs and private schedulers are forbidden without exception (176); unregistered hooks and unbuilt REAPER roots are written as such (177); event tables and counts match the code (158, 160, 180, 186).
