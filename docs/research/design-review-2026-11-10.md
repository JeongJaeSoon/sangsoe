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

**Commit reviewed.** `72fb3fed8ef78af1437348a0235607d0b32ee531` (main when the review began). Every `path:line` below is a line of that commit; `git show 72fb3fe:<path>` prints the file as cited. One change landed on main while the review ran (the model-selection table, decisions 164 and 165). It is not reviewed here. It shifts line numbers in `docs/design.html`, `docs/design-appendix.html`, `docs/glossary.md`, `docs/decisions.md`, `docs/architecture.md` and `claude-plugin/agents/worker.md`, and it adds a fourth MCP resource and one doctor check, so the counts in S19 and S20 are those of the reviewed commit.

**Files read.**

| Set | Files | How |
|---|---|---|
| Design | `docs/design.html`, `docs/blog-intro.html`, `docs/architecture.md`, `docs/glossary.md`, `docs/switch-conditions.md`, `docs/test-outcomes.md`, `docs/port-map.md`, `docs/port-plan.md`, `docs/requirements-coverage.md`, `README.md` | in full |
| Design | `docs/decisions.md` | in full, split over readers by decision range |
| Design | `docs/design-appendix.html` | in full across readers; see section 9 for which ranges were sweep-only |
| Design | `docs/diagrams/*.svg` | text labels only |
| Code | `core/land/`, `core/verify/`, `core/approve/`, `core/gates/`, `core/reaper/`, `core/detect/pr/`, `core/detect/queue/`, `core/session/record.ts`, `core/recover/`, `core/owner/`, `core/contract/` (event list, transitions), `core/brief/` (status, count line, panel), `orca-plugin/` (worker entry, core link, timer, panel requests) | the files named in the findings in full, the rest by search |
| Judgment layer | `claude-plugin/agents/*.md`, `claude-plugin/skills/deliver-ticket`, `end-session`, `orchestrate`, `claude-plugin/hooks/`, `claude-plugin/mcp/` (tool and resource lists, `decision_answer`, `item_create`) | in full or the cited parts |

**Method.** The set was split into slices. Each slice was read by a reviewer with no stake in the others, and every claim used here was then checked again at its line by the lead reviewer. Findings that did not survive the second read are left out.

**Limits.** This is a reading review.

- Nothing was run against a live store or a live Orca. Where a consequence follows from reading two places together, the finding says *inferred*. Where it would need a run to be sure, it says *not run*.
- The test suite was not rerun, and the design-name test from the last name check was not rerun (by instruction).
- `claude-plugin/skills/general/` (the general skills) was not reviewed for content.

## 2. Verdict

The design holds on the owner's hard rules as far as reading can show: sqlite stores no copy of a field Orca owns, nothing runs outside the Orca plugin worker's timer, the token-using and token-free parts are separate and tests guard the boundary, and `land` binds a verdict to one exact head from record to merge. It is not ready for a stable tag. Three code paths either cannot work in a real install or let text that is not the owner's act as the owner's (M1 to M3), one core flow ends two different ways depending on which file a session reads (M4), and the two documents an outsider reads first state things that are not true of main (M5, M6). None of these needs a redesign: each is one missing entrance, one narrowed condition or one rewritten passage. Most of the should-fix list is documentation the build has moved past: `docs/decisions.md` adds later decisions without marking the earlier ones they replace, and `docs/design.html` and the appendix still read as written before the first build. Recommended order: fix M1 to M6 and the NOW items, run the smoke with M1, M2, M4 and S3 as explicit measurements, then make one documentation pass.

## 3. Must-fix

### M1. Nothing can record verification evidence, so `land` refuses every PR above V0

- **Where.** `core/land/land.ts:184` asks `evidenceGaps` for the kinds the tier needs. `core/verify/evidence.ts:35` reads `evidence` rows at the head. The refusal's fix text at `core/land/land.ts:191` says "record evidence{kind, head_sha…" and names no command. `claude-plugin/skills/deliver-ticket/SKILL.md:40` tells the worker that `land` refuses with `evidence_missing` and names no tool either.
- **What.** The only production writers of `evidence` are the owner-queue ones (`core/owner/probe.ts:152`, `core/owner/done.ts:58`, `core/owner/link.ts:128`, `core/owner/link.ts:157`), and they write `probe:` and `owner_act:` kinds. No CLI command and none of the 12 MCP tools writes a `test`, `run`, `ui` or `dev` row. The tests pass because they append the row themselves (`core/land/land.test.ts:87`, `test/land/fake-deps.ts:62`).
- **Same shape, second case.** `stage_recorded` has readers (`core/graph/ready.ts:103`, `core/verify/evidence.ts:52`) and no writer. Both shipped flows wait on it through `deploys_after` (`core/graph/flows/ship-change.toml:31`, `core/graph/flows/ship-change.toml:45`, `core/graph/flows/ship-batch.toml:30`), and `docs/design.html:403` describes the edge as working.
- **Consequence (inferred, not run).** In a real install a PR above V0 cannot be landed by an agent, and the deploy steps of both flows never become ready.
- **Fix.** One recording entrance for `evidence` and one for `stage_recorded` (MCP tool plus CLI over one core function), with the same "the PR's author cannot record its own" rule the reader already applies at `core/verify/evidence.ts:15`. Name the tool in the refusal text and in `deliver-ticket`.
- **Class.** NOW.

### M2. The chat hook treats any prompt in any session as the owner's words, and one mentioned decision number as that decision's answer

- **Where.** `core/session/record.ts:69`, `core/session/record.ts:79`, `core/session/record.ts:99`, `core/session/record.ts:105`.
- **What.** A prompt counts as owner speech unless it is empty or starts with one of two fixed openings. That holds in dispatched sessions too. If the text then mentions exactly one `dNNN`, the whole prompt is passed to `decisionAnswer` with `linkedBy: "hook"`, which closes the decision and releases its gate.
- **Why it matters.** The rule "owner input alone never changes state" assumes the input is the owner's. A message from another session, a reply to a worker's question, or a pasted status line that happens to name one decision is none of those, and it would answer the decision.
- **Basis.** The mechanism is read. Delivery of non-owner text as a prompt was seen once during this review: a message from the coordinating session reached the reviewing worker session as an ordinary prompt that starts with neither opening.
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
- **Consequence (inferred, not run).** `docs/design.html:360` says an accepted `worker_done` completes a Task, and `core/brief/item_status.ts:53` maps `completed` to done. If Orca completes the Task on the author's `worker_done`, the item shows as done before the merge, which decision 84 ① forbids.
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
- **Guards stated as enforced.** `docs/design-appendix.html:753` lists a dangerous-command guard, refusal of reading another session's Orca messages, a stacked-PR guard and a "claimed fixed without a run" block. `docs/design-appendix.html:769` says the floor refusals (force-push to the default branch, writing protection rules, deleting out of scope, emptying the trash) are refused by a hook "결정적으로" with a test per item. The "claimed fixed" block is repeated as working at `docs/design-appendix.html:214`, `docs/design-appendix.html:268` and `docs/design-appendix.html:782`. The port map marks these as not ported (`docs/port-map.md:57`, `docs/port-map.md:59`, `docs/port-map.md:60`), and the hook has six gates, none of which is one of these.
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
The roots in `docs/decisions.md:178` include open Orca Tasks (`task-list`), and the appendix repeats it (`docs/design-appendix.html:206`, `docs/design-appendix.html:228`, `docs/design-appendix.html:1030`); the REAPER port takes `worktreeList`, `worktreePs`, `workerList` and `worktreeRm`, and `task-list` is not among them (`core/reaper/round.ts:15`). "큰 자원부터" (`docs/decisions.md:183`) and adopting containers at `compose up` (`docs/decisions.md:174`) are not built either.
Fix: build the open-Task root or strike it with a reason; strike the other two. Class: NOW for the root (it is a protection), LATER for the rest.

**S11. In a git checkout the plugin worker runs a core the approval does not cover.**
`orca-plugin/core-link.ts:52` falls back to `../core` when the plugin folder sits in a git checkout. The dirty check runs on the plugin folder only (`core/approve/ports.ts:83`). `README.md:55` states the approval covers the core the plugin runs, which is true of a release and not of a checkout.
Fix: when the checkout path is used, check the whole tree, or say in the README that a checkout load is outside the approval. Class: NOW (wording), LATER (code), revisit if a checkout is ever used for real work.

**S12. A stall is raised after sleep or an Orca restart.**
`core/detect/queue/stall.ts:17` compares the last timer row with three periods. After the machine sleeps, the first check sees a long gap. Read, not run.
Fix: ignore a gap that spans the worker's own start. Class: LATER, revisit on the first false alarm after wake.

### 4.2 Design text the build has moved past

**S13. The approval text describes a fingerprint that does not exist.**
`docs/design.html:194`, `docs/design.html:243` and `docs/design.html:253` describe a fingerprint from `orca plugin inspect` bound to content. Decision 105 says `inspect` gives none and condition (2) is a content hash (`docs/decisions.md:353`). `docs/glossary.md:328` and `docs/design-appendix.html:847` carry the old text too. Drift is described as a hash comparison (`docs/decisions.md:395`) while the monitor compares versions and leaves hashes to doctor (`core/detect/queue/drift.ts:10`).
Fix: rewrite the five passages. Class: NOW.

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
- So do `flow_step_skipped`, `observed_change`, `refusal_report`, `worker_done` and `worker_idle` (`docs/design-appendix.html:126`, `docs/design-appendix.html:141`). `model_changed` was in the same state at the reviewed commit; the change that landed during the review gave it a writer.
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
`docs/switch-conditions.md:3` says an empty evidence cell means unmet. The empty rows are B1, B2, B4, C3 to C13, D1 to D3 and I1 to I3. `docs/blog-intro.html:489` says the old tooling is switched off only when all 46 pass.
Fix: fill each from the smoke (its tally is the natural place), or record which are deferred and why. Class: NOW.

**S27. Smaller slips in the record.**
- `docs/decisions.md:3` and `docs/decisions.md:27` promise a reference-format change before publishing that was not made.
- The "tensions" section at the end (`docs/decisions.md:526`, `docs/decisions.md:528`, `docs/decisions.md:536`) still lists things to test before building.
- `docs/test-outcomes.md:3` allows three verdicts; rows at `docs/test-outcomes.md:21`, `docs/test-outcomes.md:23` and `docs/test-outcomes.md:26` use a fourth.

Fix: with the documentation pass. Class: LATER.

## 5. Notes

| # | Note | Where | Class |
|---|---|---|---|
| N1 | The event table only grows, and the brief reads all of it each time. Fine at this size; no compaction or bound is designed. | `core/store/schema.ts:53`, `core/brief/load.ts:78` | LATER, when a brief takes over a second |
| N2 | pr-monitor reads one page of 30 closed PRs per round. After long downtime a merge can fall off the page. | `core/detect/pr/round.ts:12`, `core/detect/pr/round.ts:386` | LATER, first missed merge |
| N3 | Gates match command shapes and pass what they cannot parse; role comes from the first prompt's opening. This is the same "cooperating sessions" boundary as the known recorder check. | `core/gates/index.ts:62`, `core/gates/delegate.ts:64` | DROP: by design, but say it once in the design |
| N4 | When no check is required by branch protection, `land` counts every check that has reported. A check that has not started yet is not waited for. | `core/land/land.ts:259` | LATER, first merge that beat a late check |
| N5 | The manifest declares read-only capabilities while the worker removes worktrees through the CLI. | `orca-plugin/orca-plugin.json:11` | NOW: one sentence in the README on why |
| N6 | `sangsoe recover` marks a lost worker with the warning emoji the glossary reserves for an unclear trigger. | `core/recover/recover.ts:39` | LATER |
| N7 | The glossary and appendix still name a Python hook file from the old tooling. | `docs/glossary.md:265` | LATER, documentation pass |
| N8 | The appendix lists `graphlib` as adopted; the code does not use it. | `docs/design-appendix.html:994`, `docs/glossary.md:193` | LATER, documentation pass |
| N9 | `docs/test-outcomes.md` carries opaque identifiers from the build machine (lines 11, 14, 17 and 18). They are not secrets. | `docs/test-outcomes.md:11` | NOW: replace with placeholders, as the rest of the file does |
| N10 | Decision 158's boundary sentence names the recorder check only. The config key, the sqlite file and PR labels are all writable by any session under the same user. | `docs/decisions.md:401`, `core/land/ports.ts:19` | NOW: one sentence, with S1 |
| N11 | With Orca closed, nothing detects and nothing says so. If the sqlite file is lost, items disappear from the brief until recreated; the only backup is taken at schema migration. | `orca-plugin/timer.ts:20` | LATER: an owner question, see section 6 |
| N12 | The boundary tests have two gaps: the launch-agent check looks for one file suffix only, and two tests import across the plugin boundary. | `test/layout.test.ts:136`, `core/install/stage.test.ts:7`, `cli/commands/item-new.test.ts:3` | LATER |

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
| Use what Orca and Claude Code already give | Yes | Timer is the plugin worker's (`orca-plugin/timer.ts:20`); hooks, MCP, skills and agents are the host's own mechanisms; the core calls the Claude CLI only for version and plugin management (`core/install/host.ts:63`) |
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
- The smoke has not been run. M1, M2, M4 and S3 should be on its list.
- The reviewer-name rule refuses a name with a colon.

## 9. Coverage of the appendix

`docs/design-appendix.html` has 1116 lines. The slice reviewers read lines 1 to 200, 280 to 327, 398 to 417, 740 to 777 and 938 to 953, and searched the rest. Two further readers with a fresh context and the same model then read lines 200 to 620 and 620 to 1116 end to end. They were given the facts already established and asked only to list passages that disagree with them. Each passage used in this report (S24 and the appendix lines added to M6, S10, S14, S18 and S19) was checked again at its line. Passages they marked uncertain are left out.
