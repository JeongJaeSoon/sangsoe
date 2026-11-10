# Design review, 2026-11-10

A read-only review of the whole design set: against itself, against the code on main, and against the owner's hard rules. It changes no document and no code. Every finding carries a place (`path:line`), a proposed fix and a proposed class:

- **NOW**: fix before the stable tag.
- **LATER**: defer, with the trigger that brings it back.
- **DROP**: leave, with the reason.

## 1. What was reviewed, and how

**Model proof.** The repo keeps model names and versions in one file (`core/models/table.ts`, decisions 164 and 165), and `test/model-table.test.ts` fails on a second copy anywhere else. So this report names the model by reference, and the literal strings are quoted in the pull request that added this file.

- Model: the `currentId` of the `frontier` row in `core/models/table.ts`, as that file stands on main after decisions 164 and 165.
- `claude --version` printed `2.1.322 (Claude Code)`, the version that table records as checked.
- The session transcript carries that id in the `model` field of every assistant record (256 of 256 when the first draft was written) and no other id. The transcripts of the eight subagents used below carry the same id on every record and no other.
- The session's status line showed that model's name followed by the effort setting `high`.
- Section 10's help-text sweeps ran on smaller models, as the instruction for that section allowed. The judgment there, and every line of this report, is the session model's.

**Commit reviewed.** `72fb3fed8ef78af1437348a0235607d0b32ee531` (main when the review began). Every `path:line` below is a line of that commit; `git show 72fb3fe:<path>` prints the file as cited. Three changes landed on main while the review ran: the model-selection table (decisions 164 and 165), then two more rows in `docs/test-outcomes.md`, then an install and doctor change (decisions 166 to 168). None is reviewed here. The second shifts line numbers in `docs/test-outcomes.md`. The third shifts them in `README.md`, `core/install/host.ts`, `core/checks/index.ts` and the later part of `docs/decisions.md`, and it adds doctor rows. The first shifts them in `docs/design.html`, `docs/design-appendix.html`, `docs/glossary.md`, `docs/decisions.md`, `docs/architecture.md`, `core/checks/index.ts`, `claude-plugin/agents/lead.md` and `claude-plugin/agents/worker.md`, and it adds a fourth MCP resource and one doctor check, so the counts in S19 and S20 are those of the reviewed commit.

**Files read.**

| Set | Files | How |
|---|---|---|
| Design | `docs/design.html`, `docs/blog-intro.html`, `docs/architecture.md`, `docs/glossary.md`, `docs/switch-conditions.md`, `docs/test-outcomes.md`, `docs/port-map.md`, `docs/port-plan.md`, `docs/requirements-coverage.md`, `README.md` | in full |
| Design | `docs/decisions.md` | in full, split over readers by decision range |
| Design | `docs/design-appendix.html` | in full across readers; see section 9 for which ranges were sweep-only |
| Design | `docs/diagrams/*.svg` | text labels only |
| Code | `core/land/`, `core/verify/`, `core/approve/`, `core/gates/`, `core/reaper/`, `core/detect/pr/`, `core/detect/queue/`, `core/session/record.ts`, `core/recover/`, `core/owner/`, `core/contract/` (event list, transitions), `core/brief/` (status, count line, panel), `orca-plugin/` (worker entry, core link, timer, panel requests) | the files named in the findings in full, the rest by search |
| Judgment layer | `claude-plugin/agents/*.md`, `claude-plugin/skills/deliver-ticket`, `end-session`, `orchestrate`, `claude-plugin/hooks/`, `claude-plugin/mcp/` (tool and resource lists, `decision_answer`, `item_create`) | in full or the cited parts |

**Method.** Section 10 (built-ins) was added later and states its own method and sources. For the rest, the set was split into slices. Each slice was read by a reviewer with no stake in the others, and every claim used here was then checked again at its line by the lead reviewer. Findings that did not survive the second read are left out.

**Limits.** This is a reading review.

- Nothing was run against a live store or a live Orca, so every consequence below comes from reading. M1, M3, M4, S3 and S12 say *inferred* or *not run* in their body, and M2 says what was seen and what was not. A heading states a finding short; the body says how sure it is. Every other consequence that joins two cited places (S1, S5 to S9, S17, N2, N4, and section 10) is inferred in the same way and carries no tag; B1 and B2 say in their body what was not run or tested.
- The test suite was not rerun, and the design-name test from the last name check was not rerun (by instruction).
- `claude-plugin/skills/general/` (the general skills) was not reviewed for content, apart from the one line B3 cites, which a search found.

## 2. Verdict

The design holds on the owner's hard rules as far as reading can show: sqlite stores no copy of a field Orca owns, nothing runs outside the Orca plugin worker's timer, the token-using and token-free parts are separate and tests guard the boundary, and `land` binds a verdict to one exact head from record to merge. It is not ready for a stable tag. Three code paths either cannot work in a real install or let text that is not the owner's act as the owner's (M1 to M3), one core flow ends two different ways depending on which file a session reads (M4), and the two documents an outsider reads first state things that are not true of main (M5, M6). None of these needs a redesign: each is one missing entrance, one narrowed condition or one rewritten passage. Most of the should-fix list is documentation the build has moved past: `docs/decisions.md` adds later decisions without marking the earlier ones they replace, and `docs/design.html` and the appendix still read as written before the first build. On built-ins (section 10), nothing sangsoe built repeats a host feature; one host signal the design never weighed belongs in M2's fix if the smoke shows it covers messages (B1). Recommended order: fix M1 to M6 and the NOW items, run the smoke with M1, M2, M4, S3 and B1's three unknowns as explicit measurements (B1's first unknown before M2's fix is closed), then make one documentation pass.

## 3. Must-fix

### M1. Nothing can record verification evidence, so `land` refuses every PR above V0

- **Where.** `core/land/land.ts:184` asks `evidenceGaps` for the kinds the tier needs. `core/verify/evidence.ts:35` reads `evidence` rows at the head. The refusal's fix text at `core/land/land.ts:191` says "record evidence{kind, head_sha…" and names no command. `claude-plugin/skills/deliver-ticket/SKILL.md:40` tells the worker that `land` refuses with `evidence_missing` and names no tool either.
- **What.** The only production writers of `evidence` are the owner-queue ones (`core/owner/probe.ts:152`, `core/owner/done.ts:58`, `core/owner/link.ts:128`, `core/owner/link.ts:157`), and they write `probe:`, `owner_act:` and `owner_done` kinds. No CLI command and none of the 12 MCP tools writes a `test`, `run`, `ui` or `dev` row. The tests pass because they append the row themselves (`core/land/land.test.ts:87`, `test/land/fake-deps.ts:62`).
- **Same shape, second case.** `stage_recorded` has readers (`core/graph/ready.ts:103`, `core/verify/evidence.ts:52`) and no writer. Both shipped flows wait on it through `deploys_after` (`core/graph/flows/ship-change.toml:31`, `core/graph/flows/ship-change.toml:45`, `core/graph/flows/ship-batch.toml:30`), and `docs/design.html:403` describes the edge as working.
- **Consequence (inferred, not run).** In a real install a PR above V0 cannot be landed by an agent, and the deploy steps of both flows never become ready.
- **Fix.** One recording entrance for `evidence` and one for `stage_recorded` (MCP tool plus CLI over one core function), with the same "the PR's author cannot record its own" rule the reader already applies at `core/verify/evidence.ts:15`. Name the tool in the refusal text and in `deliver-ticket`.
- **Class.** NOW.

### M2. The chat hook treats any prompt in any session as the owner's words, and one mentioned decision number as that decision's answer

- **Where.** `core/session/record.ts:69`, `core/session/record.ts:79`, `core/session/record.ts:99`, `core/session/record.ts:105`.
- **What.** A prompt counts as owner speech unless it is empty or starts with one of two fixed openings. That holds in dispatched sessions too. If the text then mentions exactly one `dNNN`, the whole prompt is passed to `decisionAnswer` with `linkedBy: "hook"`, which closes the decision and releases its gate.
- **Why it matters.** The rule "owner input alone never changes state" assumes the input is the owner's. A message from another session, a reply to a worker's question, or a pasted status line that happens to name one decision is none of those, and it would answer the decision.
- **Basis.** The mechanism is read. Delivery of non-owner text as a prompt was seen once during this review: a message from the coordinating session reached the reviewing worker session as an ordinary prompt that starts with neither opening. Only the delivery was seen; whether the hook then wrote an `owner_action` row for it was not checked, because the review ran nothing against the store. The host's own reference says the same of the event the hook listens to (section 10, B1).
- **Fix.** Accept an answer only from a session that holds no Dispatch, and require the answer shape (the prompt starts with the decision number). Add a regression test: a dispatched session receives a prompt that mentions one open decision, and the decision stays open.
- **Class.** NOW.

### M3. A default install raises a false `timer_stalled` after three REAPER rounds

- **Where.** `core/reaper/round.ts:228` records a missing `reaper` config section as a failed root. `core/detect/queue/stall.ts:22` raises `timer_stalled` when the last three `reap_round` rows all have `roots_ok === false`. `test/reaper/scenarios.test.ts:29` pins the first half: with no config, every round is `roots_ok === false`.
- **What.** Decision 153 (`docs/decisions.md:398`) makes "no `reaper` section" the default state of a fresh install and reports it as a doctor notice. The stall check reads the same rows as a broken timer. The two decisions (149 at `docs/decisions.md:395`, 153) were never read together.
- **Consequence (inferred, not run).** Every fresh install shows a stall alarm that no action clears except writing a config section the installer deliberately does not write.
- **Fix.** Record mark-only as its own value on `reap_round` instead of a failed root, or have the stall check ignore rounds whose only failed root is the absent section. Add the test that joins the two: default config, three rounds, no `timer_stalled`.
- **Class.** NOW.

### M4. How a PR author ends is specified two ways, and neither produces the state the design promises

- **Design says** the author does not send `worker_done`: it sends a merge-wait report (`send --type merge_ready`), and the Task stays blocked on the reviewer until the merge is confirmed (`docs/design.html:440`, `docs/design.html:358`, `docs/glossary.md:46`, `docs/glossary.md:284`, decision 84 ① at `docs/decisions.md:191`).
- **The judgment layer says** the author sends `worker_done` carrying the merge-wait report (`claude-plugin/agents/worker.md:21`, `claude-plugin/skills/deliver-ticket/SKILL.md:59`, `claude-plugin/skills/end-session/SKILL.md:37`). The self-land gate agrees with the judgment layer: it inspects only `--type worker_done` (`core/gates/self-land.ts:69`).
- **Nothing sets the promised state.** No code blocks the Task when the author reports, and outside the event contract the tree names `waits_on` only where it is read (`core/brief/item_status.ts:114`). The item-creation tool does not accept the field, so in practice only "owner" appears in the brackets.
- **Consequence (inferred, not run).** `docs/design.html:360` says an accepted `worker_done` completes the Task of an item that has no PR, and that a PR item completes only when pr-monitor confirms the merge. `core/brief/item_status.ts:53` maps `completed` to done. If Orca completes the Task on any accepted `worker_done`, a PR author's item shows as done before the merge, which that line and decision 84 ① forbid.
- **Fix.** Pick one ending. Measure in the smoke what Orca does to the Task on each message type. Then align the design page, the glossary, the three judgment texts and the gate, and add a decision that says which one stands.
- **Class.** NOW.

### M5. The blog introduction tells an outside reader the system is not built yet

- **Where.** The opening says the design is "아직 구현 전" and that the first commit lands after the design review (`docs/blog-intro.html:64`). Later sections repeat it (`docs/blog-intro.html:476` "구현 전에 재 봐야 할 것", `docs/blog-intro.html:489`). The install section of the same page says pre-release builds exist (`docs/blog-intro.html:328`).
- **Also wrong on that page.**
  - The command table shows `sangsoe land <pr>` and `sangsoe verify-tier <pr>` (`docs/blog-intro.html:354`, `docs/blog-intro.html:356`). The commands take `--pr <N>` (`cli/commands/land.ts:8`, `cli/commands/verify-tier.ts:8`).
  - `sangsoe recover` is said to show each item's last session and whether a goal is set (`docs/blog-intro.html:355`). The table has neither column (`core/recover/recover.ts:38`).
  - "쓰는 tool은 열한 개다" (`docs/blog-intro.html:360`). There are 12.
  - The judgment layer is said to close owner items (`docs/blog-intro.html:394`). Since decision 162 it only tells the owner, who presses the button (`docs/decisions.md:425`).
  - chat-monitor is listed as watching mentions and replies (`docs/blog-intro.html:277`). The public tree ships only the null provider (`core/detect/chat/provider.ts:2`).
  - Three passages point at things the repo does not hold: a research note (`docs/blog-intro.html:310`), a zoom screen (`docs/blog-intro.html:372`) and a `dashboard/` folder with `cli-samples.txt` (`docs/blog-intro.html:498`).
- **Fix.** Rewrite the opening to say what exists (pre-release builds, what has been run, what has not), correct the command table and counts, and move the "measure before building" list to "measured" with a pointer to `docs/test-outcomes.md`.
- **Class.** NOW.

### M6. The appendix states guards that do not exist as enforced, and leaves a door open for a LaunchAgent

- **LaunchAgent.** The owner's rule is flat: no launch agent. `docs/design-appendix.html:755` says a LaunchAgent, a private scheduler or a private resident process may be used when listed in an exception table with a reason, and that CI fails otherwise. The same file bans them outright at `docs/design-appendix.html:975` and `docs/design-appendix.html:1035`. No exception table exists, and the only CI check is that the tree holds no `.plist` file (`test/layout.test.ts:136`).
- **Guards stated as enforced.** `docs/design-appendix.html:753` lists a dangerous-command guard, refusal of reading another session's Orca messages, a stacked-PR guard and a "claimed fixed without a run" block. `docs/design-appendix.html:769` says the floor refusals (force-push to the default branch, writing protection rules, deleting out of scope, emptying the trash) are refused by a hook "결정적으로" with a test per item. The "claimed fixed" block is repeated as working at `docs/design-appendix.html:214`, `docs/design-appendix.html:268` and `docs/design-appendix.html:782`. The port map marks the dangerous-command library, the stacked-PR gate and the claim check as not ported (`docs/port-map.md:57`, `docs/port-map.md:59`, `docs/port-map.md:60`). It does not name the message-reading refusal or the floor refusals. The hook has six gates, and none of them is any of these.
- **Fix.** Replace the exception sentence with the flat ban. Mark each unbuilt guard as not built, with the decision that deferred it, or build it.
- **Class.** NOW (wording); building any of the guards is LATER, revisit when the first incident of that kind happens under sangsoe.

## 4. Should-fix

### 4.1 Behaviour

**S1. A tier-lowering label under the shared login removes decision 158's V3 exclusion.**
`core/land/land.ts:207` keeps V3 pull requests out of the verdict merge. `core/verify/verify-tier.ts:130` accepts a lowering label when the actor is in `owners`. Decision 158 applies to single-account repos (`docs/decisions.md:401`), where every session acts under the owner's login, so any session's label counts as the owner's. `protected_paths` stay V3 regardless (`core/verify/verify-tier.ts:144`), which bounds the damage.
Fix: on a repo in `verdictMergeRepos`, judge the verdict merge on the computed tier, not the lowered one. Class: NOW.

**S2. A later, worse verdict under the same reviewer name is dropped and reported as success.**
The dedupe key is (PR, head, reviewer) (`core/approve/review-verdict.ts:49`). A second record with Act-on findings returns `ok: true` with "already recorded … stands" (`core/approve/review-verdict.ts:54`).
Fix: refuse a second record whose count differs, or put the count in the key so the worse row is stored (the reader already prefers a row with findings). Class: NOW.

**S3. The owner's panel button is probably reachable from a shell.**
`orca-plugin/main.ts:96` registers `panel.act` with no caller check, the parser checks shape only (`orca-plugin/panel/requests.ts:13`), and the handler writes an `owner_action` with a button origin and answers the decision (`core/brief/panel.ts:106`). `docs/test-outcomes.md:8` records a shell command reaching this worker's other handlers. Read, not run: running it would have changed a live store.
Fix: measure it in the smoke. If it is reachable, the "button" link no longer proves the owner pressed it; either check the caller or say so in the design. Class: NOW (measure).

**S4. `decision_answer` lets the caller claim how the answer was linked.**
The tool accepts `linked_by` values `hook` and `button` (`claude-plugin/mcp/tools/decision_answer.ts:14`); the core then only checks that an `owner_action` row is referenced (`core/decision/answer.ts:84`). With M2, such a row exists for any prompt.
Fix: the tool accepts `orchestrator` only; `hook` and `button` are set by their own entrances. Class: NOW.

**S5. pr-monitor does nothing without a `watch` section, and nothing says so.**
`core/detect/pr/round.ts:373` returns an empty round. Then no `pr_merged` is written, no Task closes on merge, and no main-CI row exists for `land` to read. Doctor has a notice for the missing `reaper` section (`core/checks/reaper-config.ts:16`) and none for this.
Fix: the same kind of doctor notice. Class: NOW.

**S6. `land`'s main freeze reads a stored row and passes when there is none.**
`core/land/land.ts:148` takes the last `main_red` or `main_green` row. With pr-monitor off (S5) or behind, a red main does not freeze.
Fix: say it in the design, or read the latest main run when the row is missing or old. Class: LATER, revisit the first time a merge goes through on a red main.

**S7. Items closed without an `item_transition` row vanish from the done count.**
`docs/design.html:293` counts done items closed inside the window, including the "evidence short" ones (`docs/design.html:360`). `core/brief/build.ts:140` counts an item only when it has a close time, and the close time comes only from `item_transition` (`core/brief/item_status.ts:84`). Items closed by an accepted `worker_done` or by the lead's `task-update` (`claude-plugin/skills/orchestrate/SKILL.md:31`) have no such row.
Fix: take the close time from the Orca Task when the row is missing, with a test. Class: NOW.

**S8. A reopened PR stays closed for good.**
`pr_closed` is written once per PR (`core/detect/pr/round.ts:411`), the fact is set and never reset (`core/graph/facts.ts:140`), and a decision that waits on such a PR is judged moot (`core/detect/queue/judge.ts:93`).
Fix: a reopen event that resets the fact, or key the close by its time. Class: LATER, revisit on the first reopened PR.

**S9. REAPER's hand-off to a person has no reader.**
`docs/design.html:152` says what REAPER cannot clear is handed to a person. `reap_blocked` is written (`core/reaper/round.ts:148`) and read only by REAPER's own bookkeeping; `resource_leak` is written (`core/detect/resource/judge.ts:92`) and read by nothing. Neither is in the brief's alarm set (`core/brief/item_status.ts:39`).
Fix: show both in the brief's alarm line, or say in the design that they are log rows. Class: NOW.

**S10. REAPER's design names a root and two rules the code does not have.**
The roots in `docs/decisions.md:178` include open Orca Tasks (`task-list`), and the appendix repeats it (`docs/design-appendix.html:206`, `docs/design-appendix.html:228`, `docs/design-appendix.html:1030`); the REAPER port takes `worktreeList`, `worktreePs`, `workerList` and `worktreeRm`, and `task-list` is not among them (`core/reaper/round.ts:15`). Two rules are not built either: "큰 자원부터" (`docs/decisions.md:183`), and the one exception in `docs/decisions.md:174` that adopts an unrecorded container whose `working_dir` leads to a merged PR's card. The other rule on that line, recording ids right after `compose up`, is built (the `resource_record` tool) and stays.
Fix: build the open-Task root or strike it with a reason; strike the order rule and the adoption exception. Class: NOW for the root (it is a protection), LATER for the other two, revisit the first time REAPER leaves a container behind because nobody recorded it.

**S11. In a git checkout the plugin worker runs a core the approval does not cover.**
`orca-plugin/core-link.ts:52` falls back to `../core` when the plugin folder sits in a git checkout. The dirty check runs on the plugin folder only (`core/approve/ports.ts:83`). `README.md:55` states the approval covers the core the plugin runs, which is true of a release and not of a checkout.
Fix: when the checkout path is used, check the whole tree, or say in the README that a checkout load is outside the approval. Class: NOW (wording), LATER (code), revisit if a checkout is ever used for real work.

**S12. A stall is raised after sleep or an Orca restart.**
`core/detect/queue/stall.ts:17` compares the last timer row with three periods. After the machine sleeps, the first check sees a long gap. Read, not run.
Fix: ignore a gap that spans the worker's own start. Class: LATER, revisit on the first false alarm after wake.

### 4.2 Design text the build has moved past

**S13. The approval text describes a fingerprint that does not exist.**
`docs/design.html:194`, `docs/design.html:243` and `docs/design.html:253` describe a fingerprint bound to content; the first takes it from `orca plugin inspect`, the second from the approval-required response. Decision 105 says `inspect` gives none and condition (2) is a content hash (`docs/decisions.md:353`). `docs/glossary.md:328` and `docs/design-appendix.html:847` carry the old text too. Drift is described as a hash comparison (`docs/decisions.md:395`) while the monitor compares versions and leaves hashes to doctor (`core/detect/queue/drift.ts:10`).
Fix: rewrite the six passages. Class: NOW.

**S14. `/goal` is still the end condition in the design.**
`docs/design.html:112`, `docs/design.html:211`, `docs/design.html:212`, `docs/design.html:357`, `docs/design-appendix.html:202`, `docs/design-appendix.html:203`, `docs/design-appendix.html:243`, `docs/design-appendix.html:683`, `docs/design-appendix.html:737` and `docs/diagrams/perspectives.svg:64` against decision 121 (`docs/decisions.md:367`) and `claude-plugin/agents/worker.md:21`.
Fix: Dispatch and `worker_done`. Class: NOW.

**S15. The design still has the lead closing owner items.**
`docs/design.html:226` against `docs/decisions.md:425` and `claude-plugin/skills/orchestrate/SKILL.md:39`.
Fix: one sentence. Class: NOW.

**S16. REAPER's default is missing from the design page.**
`docs/design.html:152` describes sweeping. A fresh install only marks until the owner adds a config section (`core/reaper/config.ts:20`, `docs/decisions.md:390`).
Fix: one sentence in the REAPER row. Class: NOW.

**S17. The PR-to-Task link is described as having no copy, and the stored row wins.**
`docs/design.html:271` says sangsoe keeps no copy of the link. `core/detect/pr/round.ts:116` returns the Task recorded on the first `pr_opened` before it looks at Orca, so a link changed in Orca is never seen. This touches the no-double-storage rule.
Fix: say the row is a snapshot that wins, or read Orca first. Class: NOW (wording), LATER (code), revisit on the first re-linked PR.

**S18. Events and tables the design lists as live have no writer.**
- Four pr-monitor events in `docs/design.html:256` (`pr_review_requested`, `pr_changes_requested`, `review_commented`, `review_replied`) exist only as contracts.
- So do `flow_step_skipped`, `refusal_report`, `worker_done` and `worker_idle` (`docs/design-appendix.html:126`, `docs/design-appendix.html:141`). `observed_change` has no writer either, and the design names it only as the fallback if one first-build test fails (`docs/design-appendix.html:223`, `docs/design.html:255`). `model_changed` was in the same state at the reviewed commit; the change that landed during the review gave it a writer.
- The cache tables `pr_ref`, `gh_budget` and `gh_seen` are created (`core/store/schema.ts:86`) and never used; production uses an in-memory cache (`core/detect/run.ts:72`). The design describes them as in use (`docs/design.html:388`, `docs/design-appendix.html:336`, `docs/design-appendix.html:337`, `docs/design-appendix.html:433`, `docs/design-appendix.html:1038`, `docs/decisions.md:47`).

Fix: trim the lists to what is written, and drop the tables or mark them reserved. Class: NOW (lists), LATER (writers), revisit when a review comment must wake a session.

**S19. Counts disagree across the set.**
- MCP tools: 11 in `docs/blog-intro.html:360`, `claude-plugin/mcp/README.md:4`, `docs/design-appendix.html:945`; 12 in `docs/design.html:370`, `claude-plugin/mcp/tools/README.md:33`, `docs/decisions.md:428`. The folder has 12.
- MCP resources: one in `docs/architecture.md:41`; "현황 1~3단계, 항목, 그래프, 결정" in `docs/design-appendix.html:947`. The folder has three (`brief`, `ready`, `item_timeline`).
- Gates: "게이트 4종" in `docs/glossary.md:311`, `docs/design-appendix.html:185`, `docs/design-appendix.html:241`, `docs/design-appendix.html:269`, `docs/design-appendix.html:273` and `docs/design-appendix.html:852`; the hook has six.

Fix: one count per thing, taken from the code. Class: NOW.

**S20. `docs/architecture.md` has three stale statements.**
- `docs/architecture.md:150` gives the doctor check list without the two checks added since (`core/checks/index.ts:31`).
- `docs/architecture.md:173` and decision 111 (`docs/decisions.md:357`) say `sangsoe review record` is the one writer of the verdict; decision 162 added an MCP tool that records it.
- `docs/architecture.md:54` says the plugin worker imports the core directly, and `docs/architecture.md:173` says plugin code imports nothing outside its folder. The second is what the code does.

Fix: three edits. Class: NOW.

**S21. Links and references to files that are not in the repo.**
`docs/design.html:83`, `docs/design.html:348` (a dashboard README), `docs/design.html:284`, `docs/design.html:285` (item and zoom mock pages), `docs/design.html:310`, `docs/design.html:346`, `docs/design-appendix.html:885` (`cli-samples.txt`). Only `docs/dashboard/hallmark-final/` exists.
Fix: add the files or remove the links. Class: NOW.

**S22. The first-build tests still read as pending.**
`docs/test-outcomes.md` records them, but the design still names the fallbacks as live options: the automation fallback for the timer (`docs/design.html:151`, `docs/design.html:462`, `docs/design-appendix.html:975`, `docs/decisions.md:192`) and `lastActivityAt` for the stuck check (`docs/design.html:255`, `docs/glossary.md:241`, `docs/design-appendix.html:223`, `docs/design-appendix.html:1044`), which the measurement ruled out (`core/detect/orca/judge.ts:55`). `docs/design-appendix.html:407` still marks its probe as partly confirmed.
Fix: one pass that replaces "to be tested" with the recorded result. Class: LATER, in the documentation pass after the smoke.

**S23. Folder READMEs and diagrams describe an earlier build.**
- `core/README.md:8`, `claude-plugin/README.md:13` and `orca-plugin/panel/README.md:4` still say later units will fill them.
- `docs/diagrams/composition.svg:95` places the general skills in a separate repo (decision 95 moved them in; `docs/port-plan.md:24`, `docs/port-plan.md:226` and `docs/glossary.md:461` say the same old thing).
- `docs/diagrams/flow-merge.svg:44` puts the review verdict on the GitHub side; it is a sqlite row.

Fix: update or delete. Class: NOW for the READMEs (they are the first thing a contributor opens), LATER for the diagrams and port plan with the documentation pass.

**S24. The appendix still describes the design as it stood before the build in several more places.**
- It knows two merge paths only (`docs/design-appendix.html:207`, `docs/design-appendix.html:253`). Decision 158's verdict merge and its config key are not mentioned anywhere in the file.
- It says two things about who closes a PR item: detectors only suggest (`docs/design-appendix.html:208`, `docs/design-appendix.html:591`, `docs/design-appendix.html:698`), and pr-monitor closes the Task after the merge is confirmed (`docs/design-appendix.html:224`, `docs/design-appendix.html:682`). The code does the second.
- It says no copy of the core sits inside the plugin (`docs/design-appendix.html:843`). A release packs one, and the approval depends on it (`README.md:55`).
- It defines SQL views and two indexes (`docs/design-appendix.html:471`, `docs/design-appendix.html:483`, `docs/design-appendix.html:424`). The schema holds no SQL view (`core/store/schema.ts:8`).
- It marks Orca verbs as used that the adapter does not call: `worker-read` (`docs/design-appendix.html:1022`), `ports` (`docs/design-appendix.html:1045`), `terminal-daemon` (`docs/design-appendix.html:1069`).
- It lists an installed tree of four skills, four gate hooks and a `bin/` folder (`docs/design-appendix.html:852`).
- It gives the panel buttons the handler does not accept (`docs/design-appendix.html:866`, `docs/design-appendix.html:868`); the handler takes an answer and a done act only (`orca-plugin/panel/requests.ts:13`).
- It uses hook events as live (`docs/design-appendix.html:322`) that the same file lists as candidates to confirm (`docs/design-appendix.html:217`), and names a Python hook file from the old tooling (`docs/design-appendix.html:701`).
- It points at a research folder the repo does not hold (`docs/design-appendix.html:401`, `docs/design-appendix.html:940`, `docs/design-appendix.html:1016`).

Fix: one pass over the appendix. Class: NOW for the first three (they describe the merge path, who closes an item, and what the approval covers), LATER for the rest with the documentation pass.

### 4.3 The decision record

**S25. Later decisions replace earlier ones without the earlier ones saying so.**
The file's convention is a parenthesis at the head of a replaced decision. These lack it:

| Earlier | Says | Replaced by |
|---|---|---|
| 37 (`docs/decisions.md:54`) | an owner's direct merge closes the item only through `close_suggested` | 84 ① and 142 (`docs/decisions.md:388`); the code closes it on merge (`core/detect/pr/round.ts:177`) |
| 111 (`docs/decisions.md:357`) | one writer of the verdict | 162 |
| 160 (`docs/decisions.md:405`) | 11 tools, one resource | 162 (`docs/decisions.md:428`) |
| 77 (다), condition (2) | fingerprint | 105 (`docs/decisions.md:353`) |
| 85 | tier values left open | 125 (`docs/decisions.md:371`) |
| 72 and 81 | merge waits for a GitHub approval | 158 adds a second path and states it replaces nothing (`docs/decisions.md:401`) |

Fix: add the head parenthesis to each, and to 158 a line that it narrows 72 and 81. Class: NOW.

**S26. Twenty of the 46 switch conditions have no evidence.**
`docs/switch-conditions.md:3` says an empty evidence cell means unmet. The empty rows are B1, B2, B4, C3 to C13, D1 to D3 and I1 to I3 (row ids of that file, not the B findings of section 10). `docs/blog-intro.html:489` says the old tooling is switched off only when all 46 pass.
Fix: fill each from the smoke (its tally is the natural place), or record which are deferred and why. Class: NOW.

**S27. Smaller slips in the record.**
- `docs/decisions.md:3` and `docs/decisions.md:27` promise a reference-format change before publishing that was not made.
- The "tensions" section at the end (`docs/decisions.md:526`, `docs/decisions.md:528`, `docs/decisions.md:536`) still lists things to test before building.
- `docs/test-outcomes.md:3` allows three verdicts; rows at `docs/test-outcomes.md:21`, `docs/test-outcomes.md:23` and `docs/test-outcomes.md:26` use a fourth.

Fix: make the format change or drop the promise, move the tested tensions to `docs/test-outcomes.md`, and use one of the three verdicts in the three rows. Class: LATER, in the documentation pass after the smoke.

## 5. Notes

| # | Note | Where | Fix and class |
|---|---|---|---|
| N1 | The event table only grows, and the brief reads all of it each time. Fine at this size; no compaction or bound is designed. | `core/store/schema.ts:53`, `core/brief/load.ts:78` | Read by type and window instead of the whole table. LATER, when a brief takes over a second |
| N2 | pr-monitor reads one page of 30 closed PRs per round. After long downtime a merge can fall off the page. | `core/detect/pr/round.ts:12`, `core/detect/pr/round.ts:386` | Page until the last PR already seen. LATER, first missed merge |
| N3 | Gates match command shapes and pass what they cannot parse; role comes from the first prompt's opening. This is the same "cooperating sessions" boundary as the known recorder check. | `core/gates/index.ts:62`, `core/gates/delegate.ts:64` | One sentence in the design that says so. NOW (wording); no code change, by design |
| N4 | When no check is required by branch protection, `land` counts every check that has reported. A check that has not started yet is not waited for. | `core/land/land.ts:259` | Wait for the checks the last main run had. LATER, first merge that beat a late check |
| N5 | The manifest declares read-only capabilities while the worker removes worktrees through the CLI. | `orca-plugin/orca-plugin.json:11` | One sentence in the README on why. NOW |
| N6 | `sangsoe recover` marks a lost worker with the warning emoji the glossary reserves for an unclear trigger. | `core/recover/recover.ts:39` | Use the alarm mark the glossary gives a lost worker. LATER, at the next change to `sangsoe recover` |
| N7 | The glossary and appendix still name a Python hook file from the old tooling. | `docs/glossary.md:265` | Name the current hook file. LATER, documentation pass |
| N8 | The appendix lists `graphlib` as adopted; the code does not use it. | `docs/design-appendix.html:994`, `docs/glossary.md:193` | Strike the row. LATER, documentation pass |
| N9 | `docs/test-outcomes.md` carries opaque identifiers from the build machine (lines 11, 14, 17 and 18). They are not secrets. | `docs/test-outcomes.md:11` | Replace with placeholders, as the rest of the file does. NOW |
| N10 | Decision 158's boundary sentence names the recorder check only. The config key, the sqlite file and PR labels are all writable by any session under the same user. | `docs/decisions.md:401`, `core/land/ports.ts:19` | One sentence, with S1. NOW |
| N11 | With Orca closed, nothing detects and nothing says so. If the sqlite file is lost, items disappear from the brief until recreated; the only backup is taken at schema migration. | `orca-plugin/timer.ts:20` | Say in the design that detection stops while Orca is closed; a scheduled backup of the sqlite file only if the owner's answer to Q2 asks for one. LATER, revisit when Q2 is answered |
| N12 | The boundary tests have two gaps: the launch-agent check looks for one file suffix only, and two tests import across the plugin boundary. | `test/layout.test.ts:136`, `core/install/stage.test.ts:7`, `cli/commands/item-new.test.ts:3` | Check for scheduler commands as well as the suffix, and move the two imports behind the link file. LATER, revisit when M6's exception sentence is replaced (the test is what backs the flat ban) |

## 6. Questions for the owner

**Q1. How far does "owner input alone never changes state" reach?**
As built, the rule holds in a narrower form: *unlinked* input alone changes nothing. Two linked inputs do change state without any observed effect:

- A chat line with a decision number closes that decision (`docs/decisions.md:287`).
- The panel's done button closes an owner item even when its `verify` probe has not passed; the item is shown as done with a flag until the probe catches up (`docs/decisions.md:288`, `core/owner/done.ts:45`, `core/owner/done.ts:65`).

The record argues that a button "points at the exact item, so it is not input alone" (`docs/decisions.md:288`), while `docs/decisions.md:313` still states the rule without the qualifier. If the owner means the strict form, the done button should wait for the probe when one exists. If the narrower form is intended, the rule should be restated that way wherever it is quoted. M2, S3 and S4 matter more under either reading, because they decide whether a "linked" input is really the owner's.

**Q2. What should happen while Orca is closed, or after the sqlite file is lost?** (N11.) The design answers two-PC use and plugin updates and is silent on these two.

## 7. The owner's hard rules, as read

| Rule | Holds? | Basis |
|---|---|---|
| No double storage | Yes, with S17 and S18 as the two edges | Contracts refuse Orca-owned keys (`core/contract/define.ts:44`); the event table is append-only (`core/store/schema.ts:53`); views are computed, not stored |
| Use what Orca and Claude Code already give | Yes for what is built; section 10 lists what the hosts offer today and the design does not use | Timer is the plugin worker's (`orca-plugin/timer.ts:20`); hooks, MCP, skills and agents are the host's own mechanisms; the core calls the Claude CLI only for version and plugin management (`core/install/host.ts:63`) |
| Keep the layers | Yes | Agents reach the core through MCP only; the worker reaches it through one link file; the layout tests pin this, with the gaps in N12 |
| Token-using and token-free are separate | Yes | No model call in `core/`, `cli/` or `orca-plugin/`; the design page puts no token-using step in a token-free cell |
| No launch agent | Yes in code; the text is M6 | No scheduler file in the tree (`test/layout.test.ts:136`); no cron, no detached process |
| Owner input alone never changes state | In the narrow form; see Q1, M2, S3, S4 | |
| Plugin approval covers what actually runs | Yes for a release; S11 for a checkout | `README.md:55` |

Also sound as read: the verdict merge binds to the exact head at record, at judgment, at re-read and at the merge call (`core/land/land.ts:221`, `core/land/land.ts:244`); unreadable reads refuse rather than pass; REAPER fails closed, never uses process ids and never forces; versions agree across the manifests; the README's commands match the CLI; and the counts of monitors (5), flows (2), agents (3), sangsoe skills (11), general skills (14) and schema tables (7) match the code.

## 8. Known open items (cited, not re-found)

These were already on record and are listed only so the picture is whole.

- Decisions 160 and 161 defer four names the judgment layer assumed and the raw `task-update` path that bypasses the transition table (`core/store/store.ts:204`). `docs/design.html:206`, `docs/design.html:433` and `docs/design.html:176` still describe classification, linking and a state-change tool as working; that wording belongs to S18's pass.
- The `review_record` recorder check stops only cooperating sessions.
- The smoke has not been run. M1, M2, M4, S3 and B1's three unknowns should be on its list.
- The reviewer-name rule refuses a name with a colon.

## 9. Coverage of the appendix

`docs/design-appendix.html` has 1116 lines. The slice reviewers read lines 1 to 200, 280 to 327, 398 to 417, 740 to 777 and 938 to 953, and searched the rest. Two further readers with a fresh context and the same model then read lines 200 to 620 and 620 to 1116 end to end. They were given the facts already established and asked only to list passages that disagree with them. Each passage used in this report (S24 and the appendix lines added to M6, S10, S14, S18 and S19) was checked again at its line. Passages they marked uncertain are left out.

## 10. Built-ins use (hard rule b, decision 78 placement order)

Added at the owner's request while the review ran. The question: does sangsoe use what the Orca CLI, the Orca plugin API, the Claude Code CLI and the Claude Code plugin system offer today, as opposed to what they offered when each decision was written?

**How it was checked.** The inventory comes from the installed tools and the published references on 2026-11-10, not from the design's own tables. Four helper readers on smaller models swept the help texts and references; one stopped before reporting, and the lead reviewer read its part (plugin manifest, subagents) directly. Every host fact in 10.2 to 10.4 was read again by the lead reviewer at the line given. The help-text entries in the 10.1 table come from the sweeps, spot-checked on five commands. sangsoe citations are lines of the reviewed commit, as everywhere in this report. Nothing was run against a live store or a live Orca here either.

**Host sources.** Line numbers are those of the text as fetched or printed that day.

| Key | Source |
|---|---|
| O-cli | Orca CLI 1.4.250 (`orca --version`): `orca --help` and the `--help` of each group and command |
| O-api | `orca skills get orca-plugin-authoring --reference host-api`, the host API reference bundled with that CLI |
| O-man | `orca skills get orca-plugin-authoring --reference references/manifest.md`, the manifest reference bundled with that CLI |
| C-cli | Claude Code 2.1.322: `claude --help`, `claude plugin --help` |
| C-hooks | `https://code.claude.com/docs/en/hooks.md` |
| C-agents | `https://code.claude.com/docs/en/sub-agents.md` |
| C-plugin | `https://code.claude.com/docs/en/plugins-reference.md` |
| C-teams | `https://code.claude.com/docs/en/agent-teams.md` |
| C-log | `https://code.claude.com/docs/en/changelog.md`, up to 2.1.322 |

**Result in short.** The design judged this same Orca version in a feature table of 50 rows (`docs/design.html:191`), and the code uses the host wherever the design names the host as the source: Tasks, gates, messages, Dispatch, worktree lineage, auto-release and recovery. No component rebuilds a host feature, so no row below says "replace". The gaps are narrower:

1. The Orca plugin hooks were judged only as a home for the gates and all eight were dropped. That reasoning is right for gates and misses the one host signal M2's fix could use, if B1's first unknown holds (B1).
2. Three Claude Code hook events the design names as sources are not registered (B2).
3. The feature table marks as used several verbs that no code calls, and the adapter carries rows that nothing calls (B3).

### 10.1 Component map

Verdicts: **keep** (uses the built-in, or nothing built in does the job), **thin** (a built-in now covers part of it), **replace** (a built-in does the same job), **add** (a built-in it should use and does not).

| Component | Built-in today | Verdict | Evidence |
|---|---|---|---|
| `core/orca/` (adapter, 36 command rows) | The Orca CLI itself; `--retry-request` with `request-show` for a lost response | keep; thin by the nine rows nothing calls (B3) | `core/orca/commands.ts:17`; O-cli `orca orchestration request-show --help` |
| `core/start/` (the one start path) | `worker-start --task --worktree new-child`, Dispatch, `dispatch-show`; the parent link is read back from Orca, not stored | keep | `core/start/lineage.ts:20`; O-cli `orca orchestration worker-start --help` |
| `core/graph/` (edges, ready view, flows) | Orca Task `--deps` and `task-list --ready` cover dependencies given at creation. `task-update` changes status only, so an edge added later, the other edge kinds and the flows have no built-in | keep | O-cli `orca orchestration task-update --help` (no flag changes dependencies); `docs/design.html:176` |
| `core/decision/` | Orca gates hold the block, the question and the options; sangsoe holds the key, the number and the answer link | keep | `core/decision/open.ts:90`; `core/contract/define.ts:44` |
| `core/notify/` | `orca orchestration send` is the only carrier | keep | `docs/design.html:179` |
| `core/detect/` with `orca-plugin/timer.ts` | A plugin with `main` and a status bar item has its worker kept running, so the worker can poll. The manifest reference has no timer or schedule field. Automations schedule an agent prompt | keep (B7) | O-api line 108; O-man (a search for timer, schedule, interval and cron finds nothing); O-cli `orca automations create --help` lines 13 and 46 |
| `core/detect/orca/` (stuck, waiting) | `worktree ps --agent-wait`, `worker-show`, the `agent.status.changed` event | keep | `core/detect/orca/judge.ts:53`; `orca-plugin/orca-plugin.json:19` |
| `core/detect/pr/` | `reference add` and `reference find` for the PR-to-workspace link; nothing built in reads GitHub state | keep; see 10.4 for the stored copy | `core/detect/pr/round.ts:81`, `core/detect/pr/round.ts:238` |
| `core/detect/resource/`, `core/reaper/` | `diagnostics memory`, `worker-list`, `worktree rm --run-hooks --delete-branch`, Orca's auto-release of a finished worker | keep; add `ports` if the design keeps it as a safety check (B3) | `core/detect/resource/round.ts:21`; `core/checks/orca-capabilities.ts:10` |
| `core/recover/` | Reviving is Orca's (`worker-start --retry-of`, `run-use`); sangsoe adds one read-only table | keep | `core/recover/recover.ts:20` |
| `core/gates/` | Claude Code `PreToolUse` command hook with `onFailure: "block"`. The Orca `agent.tool.before` hook does not reach SSH or WSL agents, as the design says, and by its reference passes on a timeout unless told otherwise | keep (B6 for the agent files) | `claude-plugin/hooks/hooks.json:11`; C-hooks lines 456 and 902; O-api lines 127 and 139; `docs/design.html:157` |
| `core/session/` (hook recorders) | Eight Claude Code hook events, all `command` hooks | keep; add two events and settle a third (B2), and add one Orca hook (B1) | `claude-plugin/hooks/hooks.json:3`, `claude-plugin/hooks/hooks.json:34` |
| `core/approve/` | `orca plugin inspect` (content hash) and `orca plugin enable --approve` | keep (S13 for the text) | `docs/design.html:186` |
| `core/install/`, `core/checks/` | `claude plugin marketplace`, `claude plugin install` and `list`, `orca plugin dev load`, `orca status` capabilities, `orca agent-context` | keep; add manifest validation (B5) | `core/install/host.ts:63`; `core/checks/claude-plugin-version.ts:12` |
| `core/store/` (sqlite event table) | Orca `storage.*` is a key-value store private to the plugin; Claude Code's `${CLAUDE_PLUGIN_DATA}` is a per-plugin folder whose variable resolves only inside Claude Code. Neither is an append-only log, and neither is reachable in the same way from the CLI, the MCP server and the Orca worker | keep | O-api line 78; C-plugin line 559 |
| `core/land/`, `core/verify/`, `core/gh/`, `core/owner/`, `core/brief/`, `core/capacity/`, `core/migrate/`, `core/contract/` | Nothing built in: neither host merges, grades evidence or keeps an owner queue | keep | O-cli `orca --help` (no merge or review group) |
| `cli/` (the `sangsoe` commands) | Nothing built in. A Claude Code plugin can ship a `bin/` folder, but the worker and the shell need the command outside a session | keep | C-plugin line 628 |
| `orca-plugin/orca-plugin.json` | Panel, command, status bar item, all four events the host offers, two read capabilities | keep; add `contributes.hooks` (B1); N5 for the capabilities | `orca-plugin/orca-plugin.json:11`, `orca-plugin/orca-plugin.json:15`; O-api line 107 |
| `orca-plugin/` worker, panel, monitors, REAPER round | `plugin.request` from the panel, `statusBar.update`; `orca plugin shot` and `orca plugin test` for evidence | keep; add `notifications.show` (B4) | O-api lines 102 and 108; `docs/test-outcomes.md:10`, `docs/test-outcomes.md:28` |
| `claude-plugin/hooks/` | Plugin `hooks/hooks.json` | keep; B1 and B2 | `claude-plugin/hooks/hooks.json:3` |
| `claude-plugin/mcp/` (12 tools, 3 resources) | Plugin MCP stdio server | keep | `claude-plugin/.mcp.json:7` |
| `claude-plugin/agents/` (3) | Plugin agents, started as the main session with `--agent`; the frontmatter can carry `tools` and `disallowedTools` | keep (B6) | `claude-plugin/agents/orchestrator.md:3`; C-agents lines 300, 301 and 877 |
| `claude-plugin/skills/` | Plugin skills; `disable-model-invocation` and `allowed-tools` are used where they fit | keep | `claude-plugin/skills/brief/SKILL.md:5`; `claude-plugin/.claude-plugin/plugin.json:7` |

### 10.2 Findings, ranked

**B1. The owner-speech check guesses from the prompt's opening, and the two hosts together state the fact.** (With M2.)

- **Claude Code alone cannot tell.** Its reference says `UserPromptSubmit` hooks "don't fire only on prompts you type": they also run for a scheduled task, for a background subagent reporting back, and for a message another session sends (C-hooks lines 1504 to 1509). The hook's input has `prompt` and `session_title` and no field for where the prompt came from (C-hooks lines 1523 to 1541).
- **Orca can.** The plugin hook `agent.prompt.before` runs when Orca is about to submit a prompt to an agent: a launch prompt, an orchestration dispatch, an issue or task prompt, or `orca terminal send`. The reference adds "A prompt a person submits is never hooked", and the event carries `terminalId`, `prompt` and an `inputKind` of `driving`, `orchestration` or `launch` (O-api lines 137 and 138). `terminal.send` gives the same for raw terminal text (O-api lines 129 and 130).
- **sangsoe today.** The chat hook matches two fixed openings (`core/session/record.ts:69`). The manifest declares no hooks (`orca-plugin/orca-plugin.json:12`), though it already requires the Orca version that has them (`orca-plugin/orca-plugin.json:9`). The design weighed the Orca hooks as a place for the gates and dropped all eight (`docs/design.html:157`, `docs/diagrams/composition.svg:63`, `docs/blog-intro.html:315`). Provenance was not weighed.
- **Why it matters beyond M2's own fix.** M2 proposes "accept an answer only from a session that holds no Dispatch". The orchestrator's session holds none, and it is the session other sessions report to. If a report reaches that terminal as a prompt, the chat hook as read would record it as the owner's words (read, not run; see M2's Basis).
- **Change.** Declare `agent.prompt.before` (observe only, always pass). The worker writes one row per prompt Orca submits: terminal and a hash of the text. The chat hook treats a prompt with a matching row as not the owner's. Prompts Claude Code injects by itself (the three cases above) never pass through Orca, so M2's shape rule stays. The manifest reference asks a hook for `main` and trusted-worker execution and for no capability (O-man); whether declaring one changes what the owner approves was not checked.
- **Not run, three unknowns.** (1) Whether an orchestration message delivered to a session passes through this hook. The reference names four cases (a launch prompt, an orchestration dispatch, an issue or task prompt, `orca terminal send`) and a message is not one of them; the `orchestration` value of `inputKind` only suggests it. If it does not, `terminal.send` is the hook to try. (2) Whether the terminal id of the hook event can be joined to the session the Claude Code hook sees. (3) Whether the row is always written before `UserPromptSubmit` fires. The hook has 2 seconds and passes on a timeout (O-api line 127), so a missed row must fall back to M2's rule, not to "owner".
- **Class.** NOW, as part of M2's fix; the three unknowns go on the smoke list, and the first decides whether this change is worth making.

**B2. Three hook events the design names as sources are not registered, and all three exist.**

- **Design.** `PermissionDenied` is the source of the refusal record, `StopFailure` of a `worker_dead` with reason `stop_failure`, and `SubagentStop` sits beside `Stop` (`docs/design-appendix.html:214`, `docs/design-appendix.html:217`, `docs/design-appendix.html:271`, `docs/glossary.md:242`, `core/contract/events/worker_dead.ts:3`, `core/contract/events/refusal_report.ts:4`). Decision 40 held the first two back until the reference was read (`docs/decisions.md:60`).
- **Host today.** `PermissionDenied` fires when auto mode denies a tool call; it cannot block, and it can tell the model a retry is allowed (C-hooks lines 39 and 1028). `StopFailure` fires when a turn ends on an API error and can be matched by error type, `rate_limit` among them (C-hooks lines 50 and 306). `SubagentStop` fires when a subagent finishes (C-hooks line 46).
- **sangsoe today.** `claude-plugin/hooks/hooks.json:3` to `claude-plugin/hooks/hooks.json:34` register eight events and none of these three. Nothing writes `refusal_report` (S18) or a `worker_dead` with that reason.
- **Why it matters.** A session that stops on an API error is silent. The only thing that notices is the stuck timer, later and without the cause. During this review the reviewing session and one helper stopped on a usage limit for several hours; whether that case raises `StopFailure` was not tested.
- **Change.** Register `StopFailure` and `PermissionDenied` as command hooks that write the two rows, or strike them from the design. For `SubagentStop`, say what it would record that `Stop` does not, or strike it from the appendix, where it sits on the hook card and in the principle table (`docs/design-appendix.html:268`).
- **Class.** NOW for the wording (with S18's pass); LATER for the hooks, revisit on the first worker lost to an API error that the stuck check reported late.

**B3. The feature table and the adapter disagree in both directions.**

- **Marked used, no call.** The appendix marks these as used: `worker-read` (`docs/design-appendix.html:1022`), `reference remove` on PR close (`docs/design-appendix.html:1038`), `search` (`docs/design-appendix.html:1040`), `ports` before REAPER removes a worktree (`docs/design-appendix.html:1045`), `terminal list`, `show` and `read` (`docs/design-appendix.html:1048`), `worktree set`, with `worker-start --comment` for the first line (`docs/design-appendix.html:1054`), `repo list` and `project list` (`docs/design-appendix.html:1059`), plugin storage (`docs/design-appendix.html:1068`) and `terminal-daemon status` (`docs/design-appendix.html:1069`). Of these the adapter's table has rows for `search` and `worktree set` only (`core/orca/commands.ts:79`, `core/orca/commands.ts:88`), neither with a caller, and the one text that runs `orca search` is a general skill recalling past sessions (`claude-plugin/skills/general/recall/SKILL.md:22`), not the item page or the owner's-words lookup the appendix names; the `worker-start` row has no `comment` flag (`core/orca/commands.ts:64`); the manifest has no storage capability (`orca-plugin/orca-plugin.json:11`). This widens the fifth bullet of S24, and it makes the count "씀 30" in `docs/design.html:191` too high.
- **All of them exist.** Each verb is in the installed CLI. `terminal-daemon` is not listed by `orca --help` but answers `orca terminal-daemon --help` with `status` and `restart`.
- **Rows nothing calls.** No production code calls nine of the adapter's 36 methods: `runCreate`, `runUse`, `ask`, `reply`, `workerRelease`, `worktreeSet`, `referenceList`, `search`, `terminalWaitIdle` (counted by search; a tenth, `requestShow`, is called only by the adapter itself). The judgment-layer texts have the sessions run some of these verbs through the CLI: `run-use` (`claude-plugin/agents/lead.md:28`), `ask` (`claude-plugin/agents/worker.md:34`), `reply` (`claude-plugin/agents/lead.md:36`), `search` (`claude-plugin/skills/general/recall/SKILL.md:22`), and `worker-release` is left to Orca's automatic release and to the lead (`core/reaper/README.md:14`). No agent or skill text names `worktree set`, `reference list` or `terminal wait`.
- **Change.** Recount the table from the code. For each marked verb, either add the call or mark it unused. One is worth building, because the design gives it a safety role: `ports` before a worktree is removed. `reference remove` is described as harmless when it fails (`docs/design-appendix.html:1038`) and can be marked unused. Drop the adapter rows nothing uses, or say what each is kept for.
- **Class.** NOW for the `ports` mark alone: it states a safety check as in use, the same kind of sentence as M6. LATER for the rest of the table, in the documentation pass with S24's fifth bullet. LATER for the `ports` call, revisit the first time REAPER removes a worktree that still had a listener. LATER for the adapter rows, at the next change to the adapter.

**B4. Nothing tells the owner outside the Orca window.**
The owner's queue shows as a status bar count and a panel (`orca-plugin/orca-plugin.json:21`). The host has a desktop notification, `notifications.show`, behind its own capability (O-api line 76). The design names a notification once, as a fallback for a status bar click that could not open the panel (`docs/decisions.md:312`), and the first-build test found that fallback unnecessary (`docs/test-outcomes.md:10`). It was not weighed for telling the owner about a new decision. Change: one notification when a decision opens or an alarm is raised, with the capability added to the approval. Class: LATER, revisit the first time a decision waits a day unseen; it is the owner's call, since it adds a capability to approve.

**B5. Neither manifest is validated by its own host in CI.**
CI runs the repo's own typecheck, lint, tests and build, and no host validator (`.github/workflows/ci.yml:48`). Both hosts ship a validator: `claude plugin validate` (C-cli) and `orca plugin validate`, which was run once by hand (`docs/test-outcomes.md:7`). Doctor reads versions and never validates. Change: run both in `sangsoe doctor`, where both CLIs are present; CI needs the CLIs installed first. Class: LATER, revisit on the first release whose manifest a host refuses.

**B6. The agent files carry no tool limits; the gate is the right place for them.**
A plugin agent can declare `tools` and `disallowedTools`, and a session started with `--agent` takes them on (C-agents lines 300, 301 and 877; a plugin agent's `hooks`, `mcpServers` and `permissionMode` are ignored, line 234). The three agent files had only a name and a description at the reviewed commit (`claude-plugin/agents/orchestrator.md:3`). The orchestrator's limits live in the delegate gate (`core/gates/delegate.ts:8`, `core/gates/delegate.ts:70`), which decides on Bash command shapes and file suffixes that frontmatter cannot express, and which denies by default: a tool or command outside its list is refused. A second list in the frontmatter would be a copy to keep in step. One loose end: the gate's list still names `TaskOutput` (`core/gates/delegate.ts:13`), a tool Claude Code has removed (C-log line 3567). Class: DROP for the frontmatter (the gate is the only place that can hold the whole rule); LATER for the stale name, at the next change to the gate's list.

**B7. The timer choice is confirmed by the host's own reference.**
The Orca manifest reference has no timer or schedule field (O-man). A plugin with `main` and a status bar item has its worker "started when it is enabled and kept running while it stays enabled, so a worker can poll" (O-api line 108). An automation runs an agent prompt on a schedule; its `--precheck` is a token-free command, but it only decides whether the prompt runs (O-cli `orca automations create --help` lines 13 and 46). So the worker timer is the built-in, and the automation fallback the design still names (S22) is not needed. Class: DROP (no change); the wording is S22's.

**B8. A host-level start check exists, and cannot yet replace the shell-text guard.**
The start guard reads the shell text a Claude Code session is about to run and names seven kinds of raw start (`core/gates/start.ts:17`). It cannot see a start from a session that is not Claude Code. The Orca hook `agent.launch.before` sees a launch "from any launcher", restores of saved sessions aside, and can refuse it or add `env` (O-api lines 135 and 136). Its event carries the agent, the workspace, the command and the environment, and no launcher, so read alone it cannot tell a supervised start from a raw one. At least two of the seven kinds (a detached `claude` process, and one held by a terminal multiplexer or a scheduler) are processes Orca never launches, so the shell-text guard stays for those. The same hook could stamp a role into the environment, which would replace the first-prompt match in `core/gates/index.ts:57` (N3). Class: LATER, revisit when a second agent kind is used as a worker or when the event names its launcher.

### 10.3 Host features the design does not use

What the inventory found that bears on the design and that sangsoe does not use, with why it should or should not. Left out as having no use here, among others: the Orca plugin API's `secrets.*`, `workspace.list`, `agents.list`, `terminal.read` and `agent.launch`, and the `editor.save.before` hook.

| Host feature | Evidence | Verdict and class |
|---|---|---|
| Orca hook `agent.prompt.before` | O-api line 137 | add: B1, NOW with M2, if B1's first unknown holds |
| Orca hook `terminal.send` | O-api line 129 | only if B1's first unknown shows that messages arrive as raw terminal text. LATER, decided by that smoke |
| Orca hook `agent.launch.before` | O-api line 135 | B8, LATER |
| Orca hooks `agent.tool.before`, `agent.tool.after` | O-api lines 139 and 141 | keep dropped. The design's reason holds: the hook does not reach a session outside an Orca terminal or an SSH or WSL agent, and its input has no session id or role (`docs/design.html:157`). The reference adds that a timeout passes unless the hook says otherwise (O-api line 127). DROP |
| Orca hooks `workspace.create.before`, `workspace.create.after` | O-api lines 131 and 133 | `after` could record a new worktree as a resource without the starter having to. LATER, with B8 |
| Orca `notifications.show` | O-api line 76 | add: B4, LATER |
| Orca plugin settings (`settings.get`, `settings.set`) | O-api lines 94 and 96 | keep the config file: the CLI and the MCP server read it outside the worker. DROP |
| Orca automations with `--precheck` | O-cli `orca automations create --help` line 46 | B7, DROP |
| Orca `ports`, `reference remove`, `worker-read` | O-cli `orca --help` | B3 |
| Orca `environment`, `worker-start --on` | O-cli `orca orchestration worker-start --help` | nothing changed. LATER (decision 88), revisit when items must be shared across machines (`docs/design.html:191`) |
| Claude Code hooks `PermissionDenied`, `StopFailure`, `SubagentStop` | C-hooks lines 39, 46 and 50 | B2: add the first two, settle the third. NOW for the wording, LATER for the hooks |
| Claude Code hook `PreCompact` (can block, can steer the summary) | C-hooks lines 59, 837 and 1037 | decision 40 lists the hooks around a compaction among the candidates to check (`docs/decisions.md:60`), and nothing in the design needs to block or steer one. `PostCompact` only records it (`claude-plugin/hooks/hooks.json:31`, `core/session/record.ts:119`), and the session-start hook is the only one that prints context (`core/session/record.ts:26`). Whether that hook runs again after a compaction was not checked; the reference lists a `compact` source for it (C-hooks line 1293). DROP |
| Claude Code hooks `TaskCreated`, `TaskCompleted`, `TeammateIdle` (agent teams) | C-hooks lines 47, 48 and 51; C-teams line 11 | agent teams are experimental and off by default, and a teammate has no Dispatch. The design's reason holds (`docs/design-appendix.html:1061`). DROP |
| Hook handler types `http`, `mcp_tool`, `prompt`, `agent` | C-hooks lines 456 and 508 | `prompt` and `agent` would put a model call in the token-free layer. `onFailure: "block"` is a field of command and http hooks, and the gate depends on it. DROP |
| Plugin monitors (`experimental.monitors`) | C-plugin lines 361 to 372 | a monitor is a background process started in each session that has the plugin; five monitors in every session would poll the same things many times over. The Orca worker timer runs once per machine. DROP |
| Plugin `userConfig` | C-plugin lines 425 and 491 | values land in Claude Code's settings, where the CLI and the Orca worker do not read. DROP |
| Plugin `settings.json` with `agent` | C-plugin line 144 | would make every session the orchestrator. DROP |
| Plugin `bin/` | C-plugin line 628 | the command must also exist outside a session. DROP |
| Plugin `channels` | C-plugin line 514 | a second message path beside Orca messages. DROP |
| Agent frontmatter `tools`, `disallowedTools` | C-agents lines 300 and 301 | B6, DROP |
| `claude plugin validate`, `orca plugin validate` | C-cli; `docs/test-outcomes.md:7` | add: B5, LATER |
| `/goal` | S14 | decision 121 moved off it; the design text still names it. S14 |
| Model and effort settings | not reviewed | the first change that landed during the review put them in one table; see 10.4 |

### 10.4 Double storage

Facts sangsoe holds that a host already owns, or holds twice.

| Fact | Where sangsoe holds it | Who owns it | Verdict |
|---|---|---|---|
| Which Task a PR belongs to | `pr_opened.task` (`core/contract/events/pr_opened.ts:4`), read before Orca | Orca reference | the stored row wins: S17 |
| PR state cache | tables `pr_ref`, `gh_budget`, `gh_seen` | GitHub | created and never used: S18 |
| "This session waits on a person" | `waiting_human`, written from the `Notification` hook with the tool and an excerpt (`core/session/record.ts:140`, `core/contract/events/waiting_human.ts:4`) | Orca computes the same fact as `agentWait`, which sangsoe also reads (`core/detect/orca/judge.ts:53`) and uses to release the row (`core/owner/release.ts:61`) | two records of one host fact. For the release the design says the first signal seen stands (`docs/design-appendix.html:126`, decision 91). It does not say what holds when Orca reports a wait and the hook wrote no row. LATER, revisit the first time the brief and Orca disagree about who is waiting |
| The owner's words | `owner_text`, masked | the Claude Code transcript; Orca search finds the text and returns no message id (`docs/design-appendix.html:1040`) | kept on purpose. DROP |
| Model and effort per role | one table since the first change that landed during the review; the agent files gained `model` and `effort` lines in the same change | Claude Code reads the agent file | not reviewed. Worth one look: whether a test ties those lines to the table. LATER, at the next change to the table |

Not double, checked: contracts refuse Orca-owned keys such as a Task's title and a gate's question (`core/contract/define.ts:44`); the gate question goes to Orca only (`core/decision/open.ts:90`); the parent link of a started unit is read back from Orca and not stored (`core/start/lineage.ts:20`).

### 10.5 Known item: `core/README.md` lists filled folders as empty

`core/README.md:6` lists what is present and already names `store/` and `orca/`. `core/README.md:8` says the list that follows is "뒤 유닛이 채울 자리(지금은 비어 있다)". `core/README.md:10` to `core/README.md:18` then name GRAPH, the land and verify functions, the decision functions, REAPER's checks, `restart_due`, the flows, `store/`, `orca/` and `install/`. Each of those folders exists and is filled at the reviewed commit (`core/graph/`, `core/land/`, `core/verify/`, `core/decision/`, `core/reaper/`, `core/session/`, `core/store/`, `core/orca/`, `core/install/`). This is the first bullet of S23. Fix: move the list under "지금 있는 것". Class: NOW.
