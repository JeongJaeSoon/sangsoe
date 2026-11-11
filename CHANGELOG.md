# Changelog

Decision numbers refer to `docs/decisions.md`.

## Unreleased

- **`start_unit` refuses on a stale MCP server.** A session's MCP server keeps the code it loaded at start, and `/reload-plugins` does not restart it. When the installed sangsoe's version differs from the server's own, or the install it started from is gone, `start_unit` returns `server_stale` with both versions before it opens the store or calls Orca. The fix it names is restarting the session. A server started under `0.1.3` or older has no such check: restart those sessions after upgrading (211).

## 0.1.3

Everything since `v0.1.2`: decision 210.

### Upgrading from 0.1.2

- **Re-approve.** `brew upgrade sangsoe` installs to a new Cellar folder and the Orca plugin's content changed (the vendored core: the load thresholds in `core/capacity`), so the Orca plugin waits for approval again. Record the review of the 0.1.3 build with `sangsoe review record`, then run `sangsoe plugin approve`, as the README's Update section says.
- **If you set the `capacity` key, restart sessions that call `start_unit`.** The pressure gate runs the installed CLI on each call, so it holds a start by the new thresholds and your `capacity` entries at once. `start_unit` counts free slots inside the session's MCP server, which keeps the 0.1.2 core it loaded at start and never reads that key. On the defaults nothing differs, because the gate already holds a start at 20 GB of free disk. With a looser entry the gate lets the start through, and a session that was running during the upgrade still reports no free slot at 20 GB or less until it is restarted.
- No doctor row changes.

### Changes

- **A machine with more than 20 GB of free disk no longer holds every start.** The disk thresholds drop from warn 50 / danger 20 GB to warn 20 / danger 10 GB, so a low-load Mac with about 38 GB free starts a worker again. A start is still held at `warn` (210).
- **Load thresholds are an optional setting.** The `capacity` key of `~/.config/sangsoe/config.json` overrides `load_per_cpu`, `mem_free_pct` and `disk_free_gb` per metric, each `[warn, danger]`; a missing or malformed entry keeps the default. No sangsoe command writes the key (210).
- **The pressure gate names what binds.** Each reason gives the metric, its value and the threshold it crossed, worst first, for example `디스크 여유 8 GB ≤ 위험 10 GB`. The resource monitor's `pressure_high` reason reads the same (210).

## 0.1.2

Everything since `v0.1.1`: decisions 208–209.

### Upgrading from 0.1.1

- **Re-approve.** `brew upgrade sangsoe` installs to a new Cellar folder and the Orca plugin's content changed (the vendored core: `start_unit`, the model catalog, install), so the Orca plugin waits for approval again. Record the review of the 0.1.2 build with `sangsoe review record`, then run `sangsoe plugin approve`, as the README's Update section says.
- **Open new Claude Code sessions.** A session keeps the hooks it loaded at start: one that was running during the upgrade still runs the 0.1.1 `PreToolUse` hook with `onFailure: "block"` until it is restarted.
- No doctor row changes.

### Changes

- **Removing or upgrading no longer freezes running sessions.** The `PreToolUse` hook no longer sets `onFailure: "block"`. A hook that cannot start because `brew uninstall` or `brew upgrade` removed the plugin folder, or that finds no `sangsoe` at all, lets the call go ahead with a hook error. A gate check that runs and fails still holds the call: the hook script turns any failure of the CLI it found into exit 2. A hook that runs past its 15-second timeout now lets the call go ahead too, so the gate waits at most 500 ms for a locked store instead of 5 seconds (208).
- **`sangsoe uninstall` removes the marketplace.** It no longer passes `--scope user`, which failed when Claude Code kept the marketplace only in the profile's known marketplaces, and a removal that leaves no marketplace counts as done. Uninstall now prints that running Claude Code sessions need a restart (208).
- **`start_unit` starts a class `mechanical` worker again.** Orca's worker-start refuses any `--effort` for the fast tier's model, so `start_unit` now passes an effort only when Orca takes it for that tier's model (`orcaEfforts` in the model catalog, read from Orca 1.4.250's launch check) and says so in the start's notes. The test Orca refuses the same pairs real Orca does (209).

## 0.1.1

Everything since `v0.1.0`: decisions 193–207.

### Upgrading from 0.1.0

- **Re-approve.** `brew upgrade sangsoe` installs to a new Cellar folder, and the Orca plugin's content changed (the panel, its worker and the vendored core), so the plugin waits for approval again. Record the review of the 0.1.1 build with `sangsoe review record`, then run `sangsoe plugin approve`, as the README's Update section says.
- **Doctor rows that change.**
  - New row `land allow`: `ok` when the settings of the Claude profile Orca starts sessions with allow `sangsoe land` (in `permissions.allow` or `autoMode.allow`), otherwise a `notice`. Doctor only reads; adding the rule is the owner's act (198).
  - `claude-plugin-version` reads the user-scope row and ends in `, 켜짐`; a disabled plugin is now `FAIL`, not `warn`, and an unknown enabled state is a `warn` (198).
  - `orca claude profile` reads the plugin even when Orca uses the checked profile, says `sangsoe enabled`, and is `FAIL` when the plugin is disabled there (198).
  - `orca-commands` counts 33 adapter commands, down from 36 (193, 202, 207).
  - `reaper-config` is a `warn` when `~/.config/sangsoe/config.json` cannot be read, because REAPER then stops every round (201); a missing file or section stays a `notice`.
  - `model-table` no longer prints a `notice` when Claude Code settings have no advisor model: each new worktree gets its advisor from its own `.claude/settings.local.json` (202). It appends today's advisor calls and estimated cost (200), prints a `notice` for `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` in the environment, and for a repository that commits `.claude/settings.local.json` prints a `notice` when your settings give an advisor model (and the advisor tool is not disabled) and a `warn` otherwise (202).

### Cut by the owner

- The five guards (dangerous commands, reading another session's Orca messages, stack nudges, unrun "fixed" claims, floor refusals) and the `SubagentStop`, `PreCompact`, `StopFailure` and `PermissionDenied` hook sources left the design; nine unused Orca adapter rows went (193).
- Not built, by the owner's decision: the comment-only diff parser, cross-PC operation, `ask` and `reply` through the core adapter, and `gh repo clone` failure handling (203).

### Start, models and advisor

- `start_unit` takes a target repository, can start from an orchestrator outside an Orca worktree, opens leads with `--keep-open`, and no longer sends the three message shapes Orca refuses (197).
- One policy row per kind of work (tier, effort, advisor, advisor budget); `start_unit` records the chosen row; `sangsoe models` and `docs/models.md` show the table; advisor calls are counted per unit and per day (200).
- `start_unit` creates the worktree first and writes the row's advisor into its `.claude/settings.local.json`; a Task past its advisor budget starts its next session with the advisor off; when the repository has no setup script, REAPER closes the shell the worktree opened (202).

### REAPER

- Before removing a worktree REAPER checks for an open Task or live session, evidence files inside it, a listener (`orca ports`) and a running compose stack, and records `reap_blocked` instead of stopping anything (194).
- Safety checks that cannot read block: the compose check skips only when `docker` is not installed, and an unreadable config stops the round (201).
- A repository sangsoe never opened a card in no longer stalls every round when its pull requests cannot be read (207).

### Monitors and events

- The pr monitor writes `pr_review_requested`, `pr_changes_requested`, `review_commented` and `review_replied`; `flow_step_skip` and `sangsoe graph skip` record a skipped step with its reason (195). Review events that ask for action wake the PR's worker (201).
- The Orca monitor reads Orca's stop and waiting mail, `worker_done` and refusal reports from the inbox; the Stop hook writes `worker_idle`; `observed_change` names the Orca fields that moved (196).
- Prompts Orca injects (new-mail notices, delivery notices, other sessions' messages, task notifications) are `orca_nudge`, never the owner's action (196, 206).

### Panel and brief

- The panel and status bar draw from one read, in local time; panel errors are one short Korean line; doctor fails on a disabled plugin and reads land allow rules; the nine contract-only events show in item history (198).
- The group detail screen follows its mockup: summary figures, dependency graph, critical path, stack chain, release batch, dangling predecessors (199).
- The panel re-reads within a few seconds of a new event in the store; a terminal open on a removed worktree prints a no-worktree line instead of `selector_not_found` (205).

### Land

- When branch protection cannot be read or does not require them, land checks each condition itself (every check on the head finished green with a recorded verdict, the head contains its base) and refuses to merge when a check fails or cannot be read (204).

### Sessions and decisions

- `decision_open` accepts `item:<task id>`; a session finds its own Dispatch across Runs and sends its handoff to that Run; whoever reads a `worker_done` releases the Dispatch with `orca orchestration worker-release` (207).

## 0.1.0 (stable)

The first stable release. It carries everything since `v0.1.0-rc.4`.

### Upgrading from 0.1.0-rc.4

- **Re-approve.** `brew upgrade sangsoe` installs to a new Cellar folder, so the Orca plugin waits for approval again. Record the review of the 0.1.0 build with `sangsoe review record`, then run `sangsoe plugin approve`, as the README's Update section says.
- **Facts backup.** The first time 0.1.0 opens the database it writes `~/.local/share/sangsoe/sangsoe.db.facts.jsonl`, a copy of the rows only sangsoe owns, including the ones rc.4 wrote (decisions 183, 192). Nothing to do; `store-restore` names the file.
- **Doctor rows that change.**
  - New rows: `claude profile` (the Claude configuration directory doctor checked), `orca claude profile` (the one Orca starts sessions with), `tier-config`, `watch-repos`, `model-table` and `store-restore`.
  - `tier-config` and `watch-repos` print a `notice` until `~/.config/sangsoe/config.json` has those settings. `model-table` prints a `notice` when Claude Code settings have no advisor model or pin model aliases, or Claude Code is newer than the model table, and a `warn` once the table is older than its date floor. `store-restore` prints a `notice` after a lost database was rebuilt. A `notice` row does not change the exit code.
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

- LaunchAgents, launchd jobs and private schedulers are forbidden without exception (176); unregistered hooks and unbuilt REAPER roots are written as such (177); event tables and counts match the code (160, 180, 186); decision 158 notes the one record check it guards.
