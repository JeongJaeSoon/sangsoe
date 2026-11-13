# Changelog

Decision numbers refer to `docs/decisions.md`.

## Unreleased

### Changes

- **`sangsoe decision moot` retires a broken decision that nothing waits on (231).** A decision whose gate Orca refused right after it was opened keeps its `dNNN` with no waiter at all, not even the orchestrator's carrier Task; the panel draws it as a broken row (219), and `decision moot` refused it with `not_moot` forever because it required at least one closed waiter. It now closes such a decision: it writes one `decision_closed` event (`reason: moot`, `evidence: tasks_closed`) and calls nothing in Orca besides the entrance's `run-current`, since there is no gate to resolve and no one to tell. A decision with an open waiter, or only a carrier Task, is still refused, and queue-monitor still never moots a decision without waiters by itself. The core changed, so the Orca plugin's vendored core changes too and needs re-approval.

## 0.1.5

Everything since `v0.1.4`: decisions 225, 227, 228 and 229. The pre-releases `v0.1.5-rc.1` and `v0.1.5-rc.2` carried the same changes, except 229 in rc.1, for checking the panel and doctor on an installed build.

### Upgrading from 0.1.4

- **Re-approve.** `brew upgrade sangsoe` installs to a new Cellar folder and the core and the Orca plugin's content (`orca-plugin/` and the vendored core) changed, so the Orca plugin waits for approval again. Have the review of the 0.1.5 build recorded with `sangsoe review record` by someone other than the session that wrote its pull request (227 refuses that session), then run `sangsoe plugin approve`, as the README's Update section says.
- **Restart every session that calls `start_unit`.** A server started under 0.1.4 keeps the core it loaded, and `start_unit` refuses on it with `server_stale` until the session restarts (211).
- **Switching from `sangsoe-rc`.** The stable formula conflicts with `sangsoe-rc`: run `sangsoe uninstall` and `brew uninstall sangsoe-rc` before `brew install JeongJaeSoon/tap/sangsoe`, then the README's Install steps, `sangsoe install --permissions` included.

### Changes

- **The panel shows no field label without its value (229).** A narrow card whose 누가 has no one, only a time, printed `누가 29h`, so the time read as the person; it now shows the time alone at the card's right end, where a decision's or to-do's elapsed time sits. A card with someone still reads `누가 <who> <time>`. In a wide panel the state column of 열린 항목, the on-hold table and a group's item tables shows each mark with its word (`🚧 막힘`, the same words as the narrow badges), group rows included; screen readers read the word once. `❔` gets the word `읽기 전` in both widths. The Orca plugin's content changed, so it needs re-approval.
- **Doctor states the permission and land facts in one row (228).** After `sangsoe install --permissions`, doctor printed `permissions: 16 of 16 …` and then a `land allow` row saying the same file allows `sangsoe land`: the 16 rules include `mcp__plugin_sangsoe_sangsoe`, which already allows the `land` tool. The `land allow` row is gone. When rules are missing, the `permissions` warn row ends with whether `sangsoe land` is still allowed by another rule (`permissions.allow`, `autoMode.allow`) or that auto mode may refuse a worker's land, and keeps its `sangsoe install --permissions` fix. The core changed, so the Orca plugin's vendored core changes too and needs re-approval.
- **The session that wrote a PR cannot record its evidence, review or stages from the command line either (227).** `sangsoe evidence record`, `sangsoe review record` and `sangsoe stage record` now run the same session check as the MCP recording tools, one core function for all six. When Claude Code started the process (`CLAUDECODE` is set), the folder the command runs in is the session's checkout; if it holds the PR's branch or head, the command refuses with `recorder_is_author`, writes nothing, and `land` keeps saying `evidence_missing` or `review_missing`. A shell without `CLAUDECODE`, such as the owner's terminal, is not checked. A Claude Code `!` line has `CLAUDECODE` set, so the owner who records there does it from a folder not on the PR's branch; a folder that is no git checkout records, where the MCP tools refuse it. The core changed, so the Orca plugin's vendored core changes too and needs re-approval.
- **The panel's cards and tables fit their content.** The gap above the header is gone (the mount reused Orca's own `#root` instead of adding a second one), and on a detail screen the header and the `‹ 뒤로` line stay pinned together. In a narrow card an empty cell takes no room, so what follows moves left, and its head names the item's state in a badge (`준비됨`, `막힘`) instead of a bare mark; the elapsed time sits at the card's right end; the next step gets the free width, up to two lines then `…`; who works on it is a badge cut with `…`. State words (`막힘`, `열림`, `진행 중`) are badges, a group's count is a badge beside its name (`막힘 2 / 10`), and `자세히 ›` sits at the right end of a narrow group row and is gone from wide tables, where the whole row stays clickable. A critical-path row with nothing under its head draws no divider. In a wide panel every table cell keeps one line and cuts with `…` (the full value is in its tooltip); group rows have a light tint and tables without groups are striped. The Orca plugin's content changed, so it needs re-approval (225).
- **The design pages describe what 0.1.4 built.** `docs/design.html`, `docs/blog-intro.html`, the appendix and the glossary now carry decisions 213 to 226: `install --permissions` and what `uninstall` removes, `item_retire` (16 MCP tools) and `pr_reopened`, the base-change re-review made by the lead's own hooks, `base_merged`, the no-CI exception to `land`, and the panel as of 222. `docs/design-vs-code.md` lists each passage and how it was handled. The README's Uninstall section names the `permissions:` line. No product code changed; `test/spec-names.test.ts` drops the allow-list entries the pages now cover.
- **Decision 227 records a gap in 0.1.4's evidence recording.** Decision 171 says the session that wrote a PR does not record its evidence, but only the `evidence_record` MCP tool checks the caller's checkout. In 0.1.4, `sangsoe evidence record` on the command line compared the recorder's name with the PR author's GitHub login and nothing else, and `land` counted the row it wrote. The decision was written down first, with no code change (`docs/decisions.md`, `docs/design-vs-code.md`); the 227 entry above is the fix.
- **The design pages and README describe what 0.1.5 ships.** `docs/design.html`, `docs/blog-intro.html` and the appendix no longer call 0.1.5 the next release: they state the panel of 225 and 229 as shipped, and that the path letting `land` pass on review and evidence alone stayed out of 0.1.5 (226 ④). The README's Land section says the session that wrote a pull request is refused with `recorder_is_author` under Claude Code (227). No product code changed.
- **First-build test T5 has run in full.** A lead holding its Run started a throwaway item twice: the second call answered `waiting already_dispatched`. A second item's start failed three times: the third left `loop_detected{start_failed_3x}`, and later calls answered `stopped`, with or without the cause. `docs/test-outcomes.md`, `docs/smoke-run.md` and the design pages record it.

## 0.1.4

Everything since `v0.1.3`: decisions 193, 199, 211, 212, 213 and 215 to 224, and 226, which keeps `land` strict and changes no code. The pre-releases `v0.1.4-rc.1` to `v0.1.4-rc.4` carried the same changes, except 224, for the S6 dependency smoke and its three re-runs.

### Upgrading from 0.1.3

- **Re-approve.** `brew upgrade sangsoe` installs to a new Cellar folder and the Orca plugin's content changed (`orca-plugin/` and the vendored core), so the Orca plugin waits for approval again. Record the review of the 0.1.4 build with `sangsoe review record`, then run `sangsoe plugin approve`, as the README's Update section says.
- **Restart every session that calls `start_unit`.** A server started under 0.1.3 keeps the core it loaded and has no `server_stale` check (211).
- **Run `/reload-skills` in running sessions.** The agent definitions apply to sessions started after the upgrade (193).
- **Run `sangsoe install --permissions` once.** Doctor's new `permissions` row warns until the sangsoe rules are in the profile's `settings.json`, as the README's install step 3 says (221, 224).
- **Retire items whose PR closed without a merge.** Such items read 🚧 until retired with `sangsoe item retire <iNNN> --reason <text> --by <who>` (223).

### Changes

- **`sangsoe install --permissions` from a Claude Code `!` line ends with the line to run.** A `!` line has no terminal to answer y/N on, so the command showed the diff and stopped with no clear next step. It still writes nothing there and exits 1, and its last line is now `… Read the diff above, then run: sangsoe install --permissions --yes`, with the same `--scope` when one was given. Doctor's `permissions` fix, the README's install step 3 and the `sangsoe:setup` skill say the same (224).
- **An item whose PR closed without a merge can be retired.** Such an item's Task is completed, so it read 🚧 forever: Orca does not reopen or cancel a completed Task, and no sangsoe path closed it. The owner or a lead now retires it with `sangsoe item retire <iNNN> --reason <text> --by <who>` or the new MCP tool `item_retire`. One store row records who and why, and Orca is not written. A retired item reads 🗑️ and leaves the 🚧 counts, the group's open count and the critical path, and a group whose items are all done or retired closes. Any other item is refused, a second retire is a no-op, and a PR that reopens reads as it is again (223).
- **The panel takes Orca's own panel tone.** The background is white everywhere; the summary line and a group's figures are cards with a light 1px border and rounded corners, and only hover, the chosen tab and an open menu are filled. Section heads are small spaced labels with a count and no rule. In a narrow panel every list row (decisions, to-dos, open items, holds, an item's chain) is one card: a one-line head of state, id, the title cut with `…` and a number at the right end, then one aligned meta line whose label and value sit together in one column; a long value wraps inside that column and is never cut. A group row heads its item cards instead of being one more card. Empty `—` values are hidden. A group row's cue reads `자세히 ›`. The third 현황 section and its tab are now `열린 항목` in the panel and the text brief, so its count no longer reads as the summary's `🔄 진행 중` count (222).
- **`sangsoe install --permissions` adds the allow rules sangsoe's sessions need.** One rule for sangsoe's MCP tools and one per Orca command the sessions run, nothing that pushes, merges, deletes or installs. It writes the Claude profile it runs under and the one Orca starts sessions with, shows a unified diff, asks y/N (`--yes` for scripts), changes nothing else in the file and keeps a backup; a second run writes nothing. `--scope project|local` writes the current directory's `.claude/` instead. `sangsoe uninstall` removes only the rules sangsoe recorded adding, where they are still present as written. Doctor adds a `permissions: N of M sangsoe rules present` row, a `warn` naming the command, and the `land allow` notice now names it as its fix (221).
- **The group detail's tables read at any panel width.** In a wide panel every graph table sizes its columns by role: ids, kinds, states and step numbers stay on one line at their own width, item cells and the long text share the rest, and text breaks only between words, so an item no longer folds over three lines while another cell sits empty. In a narrow panel each row is one bordered card whose title line is the item id and its state, with the other cells as label lines under it. Headings step down from the screen title to a section to a table inside it, and sections sit 24px apart (220).
- **A lead's own session makes its re-review item, with no command run by anyone.** Real Orca fences the plugin timer out of a lead's Run and refuses its sends (no terminal), so neither its queue round nor a wake it sends could make the item there (217 tried the wake). The Claude Code plugin's `UserPromptSubmit` and `Stop` hooks now make the item and its `blocks` edge from the session bound to that Run: store reads only when nothing is pending, no Orca call from a worker or unless the store names a pending item in a Run (219).
- **The panel reads about five times faster.** A reading's Orca calls (one CLI process each) now run side by side instead of one after another: about 1.2s to 0.24s on a store with four Runs. The status bar round reuses a panel reading from its own interval instead of reading again (219).
- **A failed wake says why.** A monitor act that Orca refused keeps Orca's code and message, and `probe.report` shows each monitor's last-round acts (219).
- **Panel fixes.** A decision no gate carries is a red broken row with its id and no answer buttons; header, tabs, breadcrumb and content share one side gutter; the breadcrumb names where the screen sits (현황 › group › item), left-aligned, with `‹ 뒤로` at the row's right end; back and a step to a screen already read paint at once from memory, then refresh; every item the critical path or a why row names is drawn in the graph; the seven figure cells wrap 4 + 3 in a narrow panel. The status bar reads `✨ SANGSOE | 🚧 N | 결정 N | 🔄 N` and is `danger` while anything is 🚧 or the owner has something to do (219).
- **An orchestrator inside an Orca worktree can leave `worktreeId` out of `start_unit`.** `[gate:delegate]` keeps the orchestrator from running `orca worktree current`, so it could not learn the id `start_unit` asked for. `start_unit` now takes the innermost worktree its folder is in, under the same live-Dispatch check a declared one gets (217).
- **Every 🚧 item in a group's detail says what it waits on.** An item whose author is done but whose PR is open or closed, one with an open owner gate, and one Orca marks blocked now each have a why-not-ready row: the stack or deploy edge it waits on, else its own PR, its decision, or the lead's reason. The item state and the rows come from one GRAPH answer. A `pending` Task with an open owner gate is no longer ready (218).
- **The critical path runs through a PR predecessor.** A PR node bound to an item stands for that item on the path, `graph critical` and `graph impact` included, and an item its own PR still holds counts as unfinished. In a group's detail such an edge is drawn from the item; a PR of another group or of no item stays a reference (218).
- **The group detail's header counts open items.** It reads `열린 N건 · 막힘 M`, the three cells that add up to N come first and ✅ sits apart after them. The breadcrumb names the current screen once, not as a link, with the back button set apart, and a second click on the same row no longer stacks the screen twice. The edge legend starts folded (218).
- **A reopened PR is open again.** pr-monitor writes `pr_reopened` when a PR it recorded as closed is open on GitHub, and a second `pr_closed` when it closes again. The re-review item, the why-not-ready row and the stack-edge removal now see a PR that was closed and reopened (216).
- **`land` does not merge into a merged PR's branch.** A PR stacked on a PR that merged with its branch kept still has that branch as its base on GitHub. `land` refuses it with `base_merged` and a fix line naming `gh pr edit <N> --base <base>`, read from GitHub's PRs for that branch (pr-monitor's rows when GitHub cannot be read) with or without a `stacked_on` edge; while another open PR uses that branch as its head, the refusal is `stack_order` naming that PR. The repo's default branch is never read as dead; a long-lived non-default branch such as `develop` can be. Right after such a retarget, `land` refuses with `base_unrecorded` until pr-monitor records the base change, so the re-review of decision 215 applies (216).
- **Items name their Run.** `item_created` and `unit_started` carry the Task's Run, so the plugin timer's queue round, `sangsoe brief` without `--run` and the panel read a lead's own Run and its items. `item_create` and `sangsoe item new` take `lead`, which `brief <group>` and `graph critical --lead` group by. Items made before this change are read as before (216).
- **The panel's group detail follows the mockup's order.** Summary tiles, the dependency graph with its side tables, why not ready and the edge table come first, then the open items by state, the latest transitions and the folded 완료 최근 7일 list (199, 213).
- **`sangsoe brief --done` opens the 완료 최근 7일 list.** The text keeps it folded to the ✅ count in the summary line; with the flag the same rows the panel lists print as a table, on 현황 and on a group's detail. A group's folded line now counts the window's rows (`✅ 완료 최근 7일 N건 (접힘)`), not every done item of the group. With no group, 현황 prints the panel's line on how a group comes to be under 진행 중 (199, 213).
- **`start_unit` refuses on a stale MCP server.** A session's MCP server keeps the code it loaded at start, and `/reload-plugins` does not restart it. When the installed sangsoe's version differs from the server's own, or the install it started from is gone, `start_unit` returns `server_stale` with both versions before it opens the store or calls Orca. The fix it names is restarting the session. A server started under `0.1.3` or older has no such check: restart those sessions after upgrading (211).
- **The brief and status bar B name a lead or orchestrator session due for a restart.** `restart_due` now has callers: the brief's first stage shows one `♻️ 재시작 권함` line per such session with the rules that hold, and status bar B adds `♻️ N` and turns danger. Only a role's latest session counts, so a `/clear` drops the old one (212).
- **An unread wake goes one tier up.** When a message sangsoe sent stays unread past `wakeMinutes`, the orca-monitor raises it to the next tier of the receiving order through notify, once per tier, as a `status` message: a worker's goes to its lead, a lead's to the Run above. The orchestrator's stays a `wake_unconfirmed` row (212).
- **`stacked_on` is added without `--stack`.** pr-monitor records a PR's head branch when it lives in the same repository, and queue-monitor's graph sync stacks an open PR on the one other open PR whose head is its base. A shared head name, a fork head or a merged base adds nothing, and an edge a session removed stays removed. PRs first seen before this version carry no head (212).
- **A close that `done_blockers` names is refused.** pr-monitor's close after a merge, the panel's 완료 and a role session's own `orca orchestration task-update --status completed` (the new `[gate:done-blockers]`) each refuse while the item has an open PR, an open flow child, a flow gap or an owner gate, and name the blocker (212).
- **`land` refuses an upper stacked PR again.** `stack_order` compared edge ends as bare ids while GRAPH writes `pr:<ref>` and `item:<task>`, so a stacked PR was never held behind its base, and a PR with no Task was refused by any such edge. It now reads both forms (212).
- **A merged item whose merge sets off a deploy reads 🔍.** An item with a `deploys_after` edge from its PR or its flow shows 🔍 until the dev stage is recorded and a passing `dev` evidence row exists (212).
- **Sessions name the Orca verbs decision 193 left to them.** A worker marks its own card with `orca worktree set` when it opens a PR (`deliver-ticket`), a lead checks that PR's link with `orca reference list` on `merge_ready` (`orchestrate`), and the orchestrator and a restarted lead find earlier words with `orca search --scope conversation`, only when the search index is enabled (`intake`, `orchestrate`). Run `/reload-skills` in running sessions; the agent definitions apply to sessions started after the upgrade (193).
- **A stacked PR whose base changed needs a new review before it lands.** After the base PR merges and the child is retargeted to `main`, only a review verdict recorded after that base change counts, even at the same head. `land` refuses with `rereview_needed`, pr-monitor sends no merge-ready wake on a GitHub approval alone, and one re-review item (made by the session bound to the item's Run, 219) `blocks` the PR's item and shows in its "왜 준비되지 않았나" row. `sangsoe review record` puts the PR's count of base changes in its key, so the same reviewer can record the same head again after a change. A review recorded before pr-monitor saw the retarget is recorded once more after `land` refuses. The queue round's graph sync also removes a `stacked_on` edge into such a PR's item when the predecessor PR's head is no longer its base, so `land` stops refusing `stack_order` on a stack GitHub already undid, and the re-review item tells its worker to call `land` again after recording (215).

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
