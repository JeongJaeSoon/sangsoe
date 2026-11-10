# Stable-tag review, 2026-11-11

An independent review before the stable tag: everything that landed on main since `v0.1.0-rc.4`, and whether every NOW item of `docs/research/design-review-2026-11-10.md` is closed on main. It changes no document and no code. Every finding carries a place (`path:line`), a proposed fix and a proposed class:

- **NOW**: fix before the stable tag.
- **LATER**: defer, with the trigger that brings it back.
- **DROP**: leave, with the reason.

Findings are numbered F1 to F12 so they do not collide with the M, S, N and B numbers of the earlier review, which section 6 refers to.

## 1. What was reviewed, and how

**Model proof.** The repo keeps model names and versions in one file (`core/models/table.ts`), and `test/model-table.test.ts` fails on a second copy anywhere else. So this report names the model by reference, and the literal strings are quoted in the pull request that added this file.

- Model: the `currentId` of the `frontier` row in `core/models/table.ts` at the reviewed commit.
- `claude --version` printed `2.1.322 (Claude Code)`.
- The session transcript, read at the start of the review, carried that id in the `model` field of every assistant record (19 of 19) and no other id, and carried the effort setting `high` on each request record that names an effort (18 of 18).
- The status line cannot be read from inside the session, so it is not quoted. A read of the names of the session's environment variables was refused by a local hook and was not run again.
- Two closure sweeps (section 6) ran on smaller models, as the instruction for this review allowed. Every row they returned that is used here was read again at its line by the session model, and the ranking and the verdict are the session model's.

**Commit reviewed.** `6667c49c9dd5d3302f96a792f0862c490b545950` (main when the review began). Every `path:line` below is a line of that commit; `git show 6667c49:<path>` prints the file as cited. One change landed on main while the review ran (pull request 56, labels for the panel's decision replies). It is not reviewed here, and it touches no file this report cites.

**Range reviewed.** `v0.1.0-rc.4` (`d4d48faad110cb2c504fa6481643be9126d243bc`) to the reviewed commit: 16 commits, pull requests 40 to 55, 183 files changed. Decisions 164 to 188 were written in this range.

**Files read.**

| Set | Files | How |
|---|---|---|
| Earlier review | `docs/research/design-review-2026-11-10.md` | in full |
| Decisions | `docs/decisions.md`, decisions 171 to 188 | in full |
| Decisions | `docs/decisions.md`, decisions 153 to 170 | the ones a finding cites, by search |
| Fix pull requests | the bodies of pull requests 43 to 55 | in full, for what each took and what each left as LATER |
| Store | `core/store/store.ts`, `core/store/backup.ts`, `core/detect/rebuild.ts`, `core/detect/run.ts`, `core/checks/store-restore.ts` | in full |
| Graph and owner | `core/graph/ready.ts`, `core/graph/task-pr.ts`, `core/graph/flow.ts`, `core/brief/item_status.ts`, `core/owner/pending.ts`, `core/owner/probe.ts`, `core/owner/marks.ts` | in full or the cited parts |
| Land and verify | `core/land/record.ts`, `core/verify/evidence.ts`, `core/approve/review-verdict.ts`, the range's diff of `core/land/land.ts`, `core/gates/self-land.ts`, `core/session/record.ts` | in full or the diff |
| Models and start | `core/models/`, `core/checks/model-table.ts`, `core/start/start.ts`, `claude-plugin/mcp/tools/start_unit.ts`, `core/install/host.ts` (the profile read) | in full or the cited parts |
| REAPER and stall | `core/reaper/round.ts`, `core/reaper/open.ts`, `core/detect/queue/stall.ts`, `core/detect/pr/round.ts` | the cited parts |
| Session | `core/session/session-start.ts`, `core/session/locate.ts` | in full |
| Orca plugin | `orca-plugin/main.ts`, `orca-plugin/core-link.ts`, `orca-plugin/panel/requests.ts`, `orca-plugin/orca-plugin.json` | in full |
| Release | `package.json`, `core/install/stage.ts`, `.github/workflows/release.yml`, `claude-plugin/.mcp.json`, the file list of the published `v0.1.0-rc.4` tarball | in full |
| Design | `docs/design.html`, `docs/design-appendix.html`, `docs/blog-intro.html`, `docs/glossary.md`, `docs/architecture.md`, `docs/test-outcomes.md`, `README.md`, `docs/diagrams/perspectives.svg` | the lines a closure row or a finding cites, by search |

**Method.** The NOW list of the earlier review was split into two slices, and a reader with no stake in the other slice checked each item against the fix pull requests and the lines on main. Every row used here was then read again at its line. The code of the range was read by subject (store, graph and owner, land, models and start, REAPER and stall, release), looking for a fix that broke another fix. Two findings were run, not only read: F1 on a built tree and on the published `v0.1.0-rc.4` tarball, and F2 with a scratch script against the store (not added to the repo). The suite was run once at the reviewed commit: 780 tests, 777 pass, 0 fail, 3 skipped. `npm run build` passed, and `npm pack --dry-run` listed 853 files.

**Limits.**

- Nothing was run against a live Orca. F2 was reproduced at the store level (two connections to one path), not inside a running plugin worker. F3 was seen as an injected line in this review's own session; the row it writes was not read from the store, and the version of the plugin installed on that machine was not checked.
- Decisions 153 to 170 were not read in full against 171 to 188. No contradiction is reported for that pair of ranges, and none was looked for beyond the decisions a finding cites.
- The token boundary and the layer rule were checked by search (schedulers, file writers, settings writes, model calls in `core/`), not by reading every module.
- Closure rows in section 6 that say *closed* rest on the fix pull request and the cited place. Code was read for M1 to M4, S2, S4, S7, S10, S13, Q1 and Q2; the wording items were read at their line.
- The live checks the fix pull requests left to the P2 smoke (a real Orca close and reopen, a real `task-list --full`, a live private-repo pr-monitor round, the advisor transport) were not run here, by instruction.

## 2. Verdict

**No-go as main stands, on one finding; go once it is fixed.** The installed command line and the installed MCP server cannot load either bundled flow template, because the build does not copy them to where the loader looks (F1, reproduced on a built tree and visible in the published `v0.1.0-rc.4` tarball). `flow_expand` is the documented way to lay out a program, so a stable tag would ship a core path that fails on every installed machine. The fix is a build step and one line in the release smoke test. Everything else found is narrower. Two more are proposed as NOW because they are small and their failure is silent: a database lost while Orca is open leaves the plugin worker writing to a file nobody else reads (F2), and the SessionStart hook tells a session that another tool dispatched through Orca to stop and wait (F3). Of the earlier review's NOW list, M1 to M6, Q1, Q2 and the S items are closed in code or wording; four small notes (N3, N5, N9, N10) and part of S14 were neither fixed nor recorded as deferred (F7). Nothing was found against the owner's hard rules (section 7); the edges are stated there.

## 3. Must-fix

### F1. The bundled flow templates are not where the installed command line and MCP server look

- **Where.** `core/graph/flow.ts:128` resolves the bundled directory relative to the module (`./flows/`), and `loadFlow` (`core/graph/flow.ts:132`) looks in the user directory and then there. The build is `tsc` alone (`package.json:23`), which emits no `.toml` file, and the packed files are `dist/` plus the plugin folders (`package.json:10`). The Claude plugin's MCP server runs from `dist/` (`claude-plugin/.mcp.json`). `claude-plugin/agents/lead.md:31` tells the session that plans a program to lay out fixed flows with `flow_expand`.
- **Seen.** On a tree built at the reviewed commit, loading `ship-change` through the built module is refused with `no flow template ship-change in` the user directory and `dist/core/graph/flows/`; the same call on the source tree loads the template (6 steps). The published `v0.1.0-rc.4` tarball holds the two templates only under `orca-plugin/vendor/core/graph/flows/`, the plugin worker's staged copy, and the worker never expands a flow. Nothing in `core/install/`, `cli/`, `scripts/` or `.github/` copies the templates anywhere, and no fix pull request lists this as left for later. The release smoke test (`.github/workflows/release.yml`) does not load a flow, and the unit tests run from source, where the directory exists.
- **Consequence.** `flow_expand` and `sangsoe flow expand` with `ship-change` or `ship-batch` fail on every installed release unless the owner has put a template of that name in the user flows directory by hand. Older than `v0.1.0-rc.4`, and still open.
- **Fix.** Copy `core/graph/flows/*.toml` into `dist/core/graph/flows/` as part of `npm run build` (or ship the directory and resolve it from the package root), and add a release smoke step that expands a bundled flow from the packed tree.
- **Class.** NOW.

## 4. Should-fix

### F2. A database lost while Orca is open: the plugin worker keeps writing to the file it holds

- **Where.** The plugin worker opens its runners once and keeps them (`orca-plugin/core-link.ts:69`, `orca-plugin/main.ts:113`); each runner opens one store for its life (`core/detect/run.ts:70`, `core/reaper/open.ts:14`). The rebuild happens in `Store.open` (`core/store/store.ts:215`), so it is done by whichever process opens the path next: a command, an MCP tool call, the panel. The reread is owed through a `signal` row that the monitors read from their own store (`core/detect/run.ts:92`). Doctor's fix text is at `core/checks/store-restore.ts:27`.
- **Seen (store level).** One connection writes two rows, the file is removed, a second opener rebuilds from the facts file and reads "reread owed". The first connection then appends a third row at seq 3, does not see the reread signal, and its rows are not visible to the second opener. The facts file now holds two different rows under seq 3 (`store_rebuilt` from the rebuild, the round row from the held connection); `readBackup` keeps the later line of a seq (`core/store/backup.ts:130`), so the next restore drops the rebuild signal.
- **Consequence.** Until Orca restarts, the host reread never runs, monitor and REAPER rows go to a file no reader opens, and the shared facts file takes two histories. Doctor says "opening Orca" starts the reread, which is wrong when Orca is already open. Decision 184 describes the lost-while-closed case only.
- **Fix.** Before each round, compare the identity of the file at the path with the one the runner opened and reopen on a difference. Until then, change the doctor text and decision 184's wording to "restart Orca (or disable and enable the plugin)".
- **Class.** NOW: a reproduced defect in what this range added, with a small guard. If the guard is deferred, the wording change alone is NOW.

### F3. The SessionStart hook treats any Orca Dispatch in the worktree as a session sangsoe started

- **Where.** `core/session/locate.ts:51` to `:77` finds the unsettled Dispatch of the worktree that holds the session's directory, from Orca alone. `core/session/session-start.ts:28` to `:38`: when that Task's spec has no role line, the hook writes `worker_stuck` with reason `no_role_line` and injects a line telling the session to tell its lead and wait. `docs/decisions.md:70` (decision 46) says this applies to sessions sangsoe started and that a session opened by hand is left alone; `docs/glossary.md:245` says the same.
- **Seen.** This review ran as a Task that another orchestration tool dispatched through Orca, on a machine with the sangsoe plugin installed. After a compaction the session received exactly that injected line. No commit in the range touched either file.
- **Consequence.** A Task that a different tool dispatched is not a session opened by hand, and it is not one sangsoe started, but the code puts it in the second group. Each such session is told to stop and wait, and a 🚨 row is written for a Task sangsoe does not own. `docs/blog-intro.html:488` says the previous tool keeps running until the switch conditions pass, so the stable tag installs beside it.
- **Fix.** Raise `no_role_line` only for a Task sangsoe has its own start row for; for any other Task return nothing, as for a session opened by hand.
- **Class.** NOW (small, and the stable tag runs beside the previous tool). LATER is defensible only if the switch is made in one step; the trigger would be the first machine that runs both.

### F4. The advisor-key presence read looks in the starter's settings directory, not the new session's

- **Where.** `core/checks/model-table.ts:51` to `:55` reads the key from the directory named by the starter's `CLAUDE_CONFIG_DIR`, or the default one. Decision 167's read of the profile Orca starts new sessions with is `core/install/host.ts:102`; install and doctor use it, this read does not.
- **Consequence (inferred).** When the two directories differ and only the starter's has the key, a session of the implementation tier is started with the note that the advisor comes from the owner's setting while no advisor applies in the session that runs. Doctor's `model-table` row has the same blind spot. Decision 187 plans to measure that pairing, and the measurement would then read sessions that had no advisor.
- **Fix.** Read the key from the directory `orcaProfile` returns, and refuse (or note "not applied") when that cannot be read.
- **Class.** LATER, with the trigger "before decision 187's measurement is read, or the first machine where Orca's selected profile is not the default one". NOW if the owner already runs a non-default profile.

### F5. An owner to-do waiting for verification has no time bound and no alarm

- **Where.** `core/owner/probe.ts:180` escalates `verify_unconfirmed` only for the mark `unverified`. That mark comes from `verifying`, which is set only by an `owner_act:seen` row (`core/owner/marks.ts:78`, `:99`). The ⏳ state is computed from the Task being complete with no passed probe (`core/brief/item_status.ts:124`), and it holds dependents (`core/graph/ready.ts:119`).
- **Consequence (inferred).** A to-do completed by a path that leaves no `owner_act:seen` row, and whose probe never passes, stays ⏳ with no escalation; its `blocks` and `after` dependents wait with it, and it is off the owner's to-do list. Decision 181 names the probe-passes case and not this one.
- **Fix.** Escalate an item that has been in the ⏳ state longer than `verify.wait_minutes` since completion, whatever its mark.
- **Class.** LATER; trigger: the first to-do that stays ⏳ for more than a day.

### F6. After a rebuild, a PR that was closed without a merge reads as "no PR"

- **Where.** `core/detect/pr/round.ts:398` skips a closed, unmerged PR that has no `pr_opened` row. `pr_opened` and `pr_closed` are host rows, so the facts file does not carry them (`core/store/backup.ts:100`).
- **Consequence (inferred).** After a rebuild the reread writes neither row for that PR. Decision 178's reading (`core/graph/task-pr.ts`) then finds no PR for the Task, so the item reads ✅ and its `blocks` dependents are released, where before the rebuild they were held as dangling. The rebuild's lost list names the rows, not this effect.
- **Fix.** During the reread after a rebuild, write both rows for a closed, unmerged PR that Orca links to a Task.
- **Class.** LATER; trigger: the first rebuild on a machine that has such an item.

### F7. Five items of the earlier review's NOW list are open and are not recorded as deferred

None of these appears in a fix pull request, as taken or as left.

- **N3.** No document says that the gates match command shapes and pass what they cannot parse. Fix: the one sentence the earlier review proposed, in the gates part of `docs/design.html`.
- **N5.** `orca-plugin/orca-plugin.json:11` declares the two read capabilities, and no README sentence says what the plugin can and cannot do with them. Since pull request 44 the worker also runs `orca terminal create` for `panel.open` (`orca-plugin/panel/requests.ts:54`), which the sentence should cover.
- **N9.** `docs/test-outcomes.md:11`, `:14`, `:17`, `:18` and `:20` still carry opaque ids (approval ids, a Run id).
- **N10.** Decision 158's boundary sentence (`docs/decisions.md:401`) is unchanged.
- **S14 (part).** `docs/design.html:358` and `docs/diagrams/perspectives.svg:64` and `:65` still describe a session as holding or being ended by `/goal`.
- **Class.** NOW as one small docs change, or an explicit LATER line for each with its trigger. Leaving them unrecorded is the defect.

## 5. Notes

### F8. A facts line written before a failed COMMIT stays in the facts file

`core/store/store.ts` appends the facts line inside the transaction, before COMMIT. A later own row that reuses the seq replaces it on restore (`core/store/backup.ts:130`); a host row that reuses the seq does not, so a restore would bring back a row the database never held. Partly listed in pull request 50's Consider list. **Class.** LATER; trigger: the first `store_rebuilt` whose restored count is above the last known own-row count.

### F9. What the facts copy holds is wider than its three examples

By decision 183's definition (copy only rows no reader writes again) the copy is not a second store; section 7 says why. Three edges: the own list includes four GitHub types that only the contract names, and `waiting_human`, which Orca also derives; a host-typed row from a source that is not a reader is copied (`core/store/backup.ts:100`); and the copy holds session, hook, REAPER and `notified` rows as well as decisions, evidence and approvals. **Class.** DROP for the first two (no reader writes those rows again, so the rule holds); LATER for a sentence in decision 183 that lists what the copy holds, trigger: the next change to `OWN_TYPES`.

### F10. Rows written by a build without the backup never reach the facts file

During an upgrade, an `v0.1.0-rc.4` plugin worker and a newer command line can share the database for a while; the older one's rows are in the database and not in the facts file, and nothing compares the two. **Class.** LATER; trigger: the upgrade note for the stable tag (one line: restart Orca after upgrading).

### F11. Leftover wording of items that are otherwise closed

- `docs/glossary.md:26` still lists the open Orca Task as a REAPER root; decision 177 says that root is not built.
- `claude-plugin/skills/README.md:4` says the skills `intake`, `write-brief`, `brief` and `deliver-ticket` are still to be written; all four folders exist.
- `docs/architecture.md:151` lists `DOCTOR_CHECKS` without `storeRestore` (`core/checks/index.ts:36` has it).
- `docs/blog-intro.html:419` and `docs/design-appendix.html:401`, `:928` and `:1004` point at files under `_research/`, a directory the repo does not have.

**Class.** NOW with F7's docs change, since each is one line; DROP is acceptable for the `_research/` pointers if the files stay private, with a sentence saying so.

### F12. Doctor's `model-table` row prints the value of each model pin

`core/checks/model-table.ts:40` prints each pin as `KEY=value`. The values are model ids, not secrets. **Class.** DROP.

## 6. Closure of the earlier review's NOW list

| Item | State on main | Where |
|---|---|---|
| M1 evidence has a writer | closed | pull request 48, decision 171; writer `core/land/record.ts`, reader `core/verify/evidence.ts` |
| M2 chat hook answer rule | closed | pull request 46, decision 173; `core/session/record.ts` |
| M3 REAPER without a config section | closed | pull request 46, decision 174 (`mark_only`); `test/reaper/scenarios.test.ts:42` |
| M4 one ending for the PR author | closed | pull request 47, decision 175; `core/gates/self-land.ts` |
| M5 blog-intro states what exists | closed, with F11's pointers | pull request 47 |
| M6 LaunchAgent ban and unbuilt guards | closed | pull request 47, decision 176 |
| S1 | closed | pull request 48 |
| S2, S4 verdict dedupe and link | closed | pull request 49, decision 179; `core/approve/review-verdict.ts:50` |
| S3 (measure) | open by design: a P2 smoke item | not a finding here |
| S5 empty watch list | closed | decision 168; `core/detect/pr/round.ts:376`, doctor `watch-repos` |
| S7 closed time | closed | pull request 49; `core/brief/item_status.ts:161` |
| S9, S11 wording | closed | decision 180; `README.md:64` |
| S10 REAPER root | closed as "not built" (decision 177), with F11's glossary line | |
| S13 | closed | pull requests 49 and 51, decision 185 |
| S14 | partly | F7 |
| S15, S16, S17, S19, S20, S21, S25 | closed | the fix pull requests, read by the sweep and at the cited lines; S20 with F11's architecture line |
| S18, S24 (first three), S26 | closed | pull request 51, decision 186 |
| S23 READMEs | closed, with F11's skills line | pull request 49 |
| N3, N5, N9, N10 | open, unrecorded | F7 |
| B1 (with M2) | closed in code; its unknowns are P2 smoke items | pull request 46 |
| B2, B3 wording | closed | B2: decision 177, `docs/glossary.md:245` |
| 10.5 | closed | read by the sweep |
| Q1 to-dos close on verification, decisions on the owner's answer | closed | pull request 51, decision 181; `core/owner/pending.ts`, `core/graph/ready.ts:119`, `core/brief/item_status.ts:124`, `docs/design.html:221`; edge F5 |
| Q2 pause, catch-up, rebuild | closed | pull requests 50, 52, 53, decisions 182 to 184; edges F2, F6, F8, F10 |

## 7. The owner's hard rules, as read

- **No double storage.** The facts copy (decisions 183 and 184) holds only rows that no reader can write again from Orca or GitHub (`isOwnRow`, `core/store/backup.ts:100`); rows a reader writes again are not copied, and are reread once after a rebuild. That is a copy for recovery of facts that exist nowhere else, not a second copy of Orca's or GitHub's data. Its edges are F8 and F9. The advisor pairing (decision 187) writes nothing to any settings file: `core/checks/model-table.ts:51` reads whether one key is present and never emits its value.
- **Use the built-ins of the Orca plugin, the Orca command line and the Claude plugin.** The rebuild's reread runs the existing Orca and pr-monitor readers once (`core/detect/rebuild.ts`). The advisor rides on the host's own setting, not a mechanism of this repo. `panel.open` uses `orca terminal create`. Nothing new was found that rebuilds a host feature.
- **Layers, and a clear line between what spends tokens and what does not.** By search, the range adds no model call to `core/`, `cli/` or `orca-plugin/`. The files written outside the database are the facts file, the gate record and the database's set-aside copies. Not read module by module (section 1, Limits).
- **No LaunchAgent.** No launchd job, plist or `orca agent launch` in the range; the only schedulers are the plugin worker's timers (`orca-plugin/timer.ts`). Decision 176 states the ban flatly.

## 8. Release integrity

- **The fingerprint covers what the worker runs.** A release stages the whole of `core/` into `orca-plugin/vendor/` (`core/install/stage.ts`), the worker loads only that copy in an installed tree (`orca-plugin/core-link.ts:47` to `:54`), and `README.md:64` states that approve and doctor compare the whole folder, the copy included. Every module the range added to `core/` is under that copy in the pack list.
- **The package ships every new module.** `npm pack --dry-run` at the reviewed commit: 853 files, no test file. Each new module (`core/models/`, `core/owner/pending`, `core/store/backup`, `core/detect/rebuild`, `core/land/record`, `core/graph/task-pr`, the four new checks, the MCP tools `evidence_record` and `stage_record`, their command-line counterparts) is present under both `dist/` and `orca-plugin/vendor/`. The one thing missing is not a module: F1's two templates.
- **Install and doctor rows for the new checks.** `core/checks/index.ts:36` lists `tierConfig`, `watchRepos`, `modelTable` and `storeRestore`. The docs list is one behind (F11).
- **Version.** `package.json` still says `0.1.0-rc.4`; the release workflow refuses a tag that is not `v` plus that version, so the stable tag needs the version change first. Expected, noted for the tag step.

## 9. Fixes against each other

- **Merge-wait (decision 178) and flow steps.** `core/graph/ready.ts:116` to `:129`: a flow step is done by its own `done_when`, any other predecessor waits for its PR to merge. Read together with `core/graph/task-pr.ts`; no conflict found beyond the two Consider lines pull request 49 already records, and F6.
- **`pending_verify` and the graph.** Consistent between `core/brief/item_status.ts:124` and `core/graph/ready.ts:119`; the gap is F5.
- **Store rebuild and REAPER, stall.** REAPER's rows are own rows and come back with the restore; the stall check starts its clock at the later of the last timer row and the store's open time (`core/detect/queue/stall.ts`), so a rebuild raises no false stall. The gap is F2.
- **Model policy and `start_unit`.** The pairing check and the `model_changed` row are in `core/start/start.ts`; the gap is F4.
- **Public contract without readers.** Decision 186 marks the contract-only events and reserved tables; no new writer without a reader was found in the range.

## 10. Known open items, not reported again

Every LATER line in the bodies of pull requests 46 to 55, and the live checks left to the P2 smoke: a real Orca close and reopen, a real `task-list --full`, a live private-repo pr-monitor round, and the advisor transport.
