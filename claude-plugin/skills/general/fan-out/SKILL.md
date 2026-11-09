---
name: fan-out
description: "Fan out parallel workers. Sweep splits one question, returns one report: /swarm, \"병렬로 훑어줘\", \"나눠서 동시에 확인해줘\". Compete runs candidates at one task, picks a base, grafts in the rest: /arena, \"경쟁시켜줘\", \"여러 버전 만들어서 비교해줘\". Landing several tickets on their own sessions is sangsoe's orchestration."
---

# Fan-out

Run N parallel workers and return one result. Pick the mode by what comes back, then read its file and follow it:

- **sweep**: one report from split or raced work. Workers cover separate slices of one question, race the same brief, or both. [references/sweep.md](references/sweep.md).
- **compete**: one artifact. Every candidate does the same task. You pick a base, graft in the best of the others and verify the result. [references/compete.md](references/compete.md).

A report from split work is sweep. One merged artifact is compete. Splitting a compete task into slices makes it a different job, so don't. Several tickets landed in parallel, each in its own session, is a sangsoe program, not this skill.

## Where workers run

Workers are subagents of this session by default: the `Agent` tool, with `isolation: "worktree"` when a worker writes. They end with this session, and nothing outside it needs to know about them.

A worker that must outlive this session, or needs its own terminal, is a new session. sangsoe opens sessions one way only: the core start procedure, reached through sangsoe's MCP start tool (decision 94). It starts the worker with `orca orchestration worker-start --worktree new-child`, so the worker has a Task, a Dispatch and a parent, and its report and escalation come back to you.

- Never open a session another way: no `orca agent launch`, no `orca orchestration worker-start` or `dispatch` called from Bash, no `orca worktree create` with a prompt or `--agent`, no background or `nohup` `claude`, no `claude -p … &`. sangsoe's guard hook refuses these (`raw_start_refused`), and a session opened outside the start procedure has no Dispatch, so its report never reaches you.
- When the start tool refuses (`start_refused`, with a reason such as `depth_exceeded` or `no_dispatch`), the work has no session. Report the refusal to whoever gave you the work as an escalation, and do not start that worker another way.
- When sangsoe's MCP server is not connected in this session, use subagents, or report that session workers are unavailable. Never fall back to a raw start.
