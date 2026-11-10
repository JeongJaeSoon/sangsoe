---
name: recall
description: "Rebuild recent working context from past sessions, live state and the shared record into a short brief. Use for \"어디까지 했지\", \"이번 주에 뭐 했지\", 'catch me up', or resuming after a restart. The status table of work in flight is sangsoe's brief."
---

# Recall

**Before you start or resume work, rebuild the user's recent working context and hand back a tight capsule of where things stand now and what to do next.**

Keep it tight and on-topic. Read only what the in-scope threads need, then stop.

Context lives in three records:

- **Past sessions** hold what was done and decided, in Claude Code's transcripts.
- **sangsoe's record** holds the work's state: Orca owns the Tasks, Dispatches, messages and references, and sangsoe's store adds what Orca lacks (decisions, extra edges, evidence). Read it, never copy it.
- **The repo's history** holds everything that happened around the same code under other names: PRs that shipped and got reverted, issues, symptoms users keep reporting. That is what `explain-code`'s **why** mode searches. A feature with a long bug tail keeps most of its story there, so don't rebuild it from transcripts alone.

## Where past sessions live

One repo's sessions span many working directories: its main checkout, every path in `git worktree list`, and Orca worktrees already removed, which sat under Orca's workspace folder for the repo (by default `~/orca/workspaces/<repo>/`).

- When `orca search --index-status` reports `enabled: true`, run `orca search "<topic>" --since <iso> --sort newest --json` with one `--path <dir>` per directory above. Drop any hit outside those paths.
- Otherwise list each directory's transcripts in `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/<dir with every character other than a letter or digit replaced by ->/`, newest first. Under Orca, `CLAUDE_CONFIG_DIR` points at the profile's own folder, so `~/.claude` is the wrong place. A removed worktree's folder name starts with the encoded workspace folder, so list the entries with that prefix, then drop any that belong to another repo whose name merely extends this one (`<repo>-web` for `<repo>`). Grep the listed transcripts for the topic.
- With no topic ("이번 주에 뭐 했지"), read each listed session's first prompt and last turns.

Never glob across the whole `projects/` folder: that reads unrelated private chats.

## Steps

1. Classify, then route. Resuming one specific earlier session is `claude --resume`, not this. The current status table of a program's work in flight is sangsoe's brief, not this. If the user already gave a full state capsule (paths, branch, the change), use it and skip the mining.
2. Lock the scope before searching. Pin the window (default the last 7 days), the topic if named, and the repo (default the current one; never read another repo's sessions without being asked). State the scope back. Never quietly turn "all" into "recent N".
3. Mine past sessions. For one or two sessions, search directly. For more, start parallel `Agent` subagents on the sweep row's model (resource `models` when sangsoe's MCP server is present, else the host's cheapest model), each taking a slice of the listed sessions. Tell each to grep the topic first, read only the matching sessions and only their relevant regions, and skip the current session plus noise (`subagents/` files, eval and probe sessions under a scratch or temporary path). Each returns one block per session: topic, the user's goal, decisions, open threads, struggles and corrections, and artifacts (PRs, branches, Task ids), citing the session file. The raw transcripts stay in the subagents.
4. Sweep the repo's history whenever the topic names a feature, file, subsystem, area, or bug. This is the default, and "my work on X" does not exempt it. Hand it to `explain-code`'s **why** mode investigators, with the question steered from "why was this built this way" to "what is the current state, what has been tried and didn't hold, and what are users still reporting". Run them in parallel with step 3. Skip this step only for pure activity recall with no named target ("이번 주에 뭐 했지").
5. Read sangsoe's record when this repo's work runs under sangsoe. Its MCP resources hold the state: `brief` (the status tiers), `item` (one item with its extra fields and evidence), `graph` (dependencies and what is ready) and `decision` (open and answered decisions). The last handoff a lead or worker saved is an Orca message of type `handoff`, readable from that Run's mailbox with `orca orchestration inbox --terminal run:<id> --full`. The resources are views over Orca and sangsoe's store, so they are current; a transcript is not.
6. Verify against live state. Check the PRs, branches, Tasks and worktrees that steps 3 to 5 surfaced with `git`, `gh`, `orca orchestration task-list`, `orca orchestration worker-list` and `orca worktree list`. When the answer hinges on what an agent actually did (tools it ran, files it read, errors it hit), read the full transcript, not a summary of it.
7. Write the brief to the contract below, grouped by thread, on the named topic.

## Output contract

Lead with the capsule, then the thread status, then the problems, then the next move. Deeper detail goes below or gets cut.

- **Capsule.** A few bullets: what this work is and where it stands overall.
- **Threads.** One line each, prefixed with exactly one status tag: `[merged #N]`, `[open PR #N]`, `[in flight <branch>]`, `[verified, uncommitted]`, `[reverted #N]`, `[planned, not started]`, or `[unverified]` when step 6 could not check it. A thread with no tag is not done yet, so tag it.
- **Problems.** Only the recurring ones. Include the symptoms users keep reporting and any fix that shipped and was reverted, so the next attempt starts where the last one failed.
- **Next move.** The single most useful next action, concrete.

A source you could not read goes in one closing line as a gap. Never turn it into a claim ("nothing changed since"). An adjacent feature stays out unless it blocks this one. When the brief outgrows a screen, cut detail before threads. Write it with `write-plainly`. Cite session findings by session file, sangsoe findings by Task id or `dNNN`, and history findings by source (PR `owner/repo#N`, commit). Leave private context out of anything that will be posted publicly.
