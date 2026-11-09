# Sweep

Fan out N parallel workers. They may cover separate slices, race the same brief, or mix both. You wait, aggregate, and return one report. When the goal is one artifact built from the best of competing attempts, use [compete](compete.md) instead.

## Phase A: Frame

1. State the done predicate and the report the sweep must return.
2. Choose the shape: partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass` or `rank all` before starting.
3. Set N from the user or derive it from the shape. N is total workers, not the concurrency limit.
4. Use the host's configured worker defaults, or the user's explicit model choice. For a comparison experiment, record each candidate's configuration before launch.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Start all N workers in one message with the `Agent` tool: `subagent_type: "general-purpose"`, `isolation: "worktree"`, and the chosen model. Drop `isolation` only when the worker reads and never writes. Run them in the foreground when you would only wait on them, so their reports return as the tool results. A worker that must outlive this session goes through sangsoe's start procedure, as the skill's "Where workers run" says, never a raw start.

When a worker must start from a non-default pushed branch, name it in the brief and have the worker check it out in its worktree first.

Every brief stands alone: the goal, scope, exact slice or race arm, how to verify, and what to report. Pass the file paths and the question, never a large document in full: each worker pays for its whole context on every turn, and N workers pay N times. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the results. Drop a result that does not record the SHAs and method its brief names, and rerun that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front: first pass or rank all. Do not paste raw worker output.

Keep a compact result table, one-line issues with their evidence, and the gaps or dropouts.

## Phase D: Report

Return one report in chat: the result table, one line per issue, gaps or dropouts, and the race rule when one was used.
