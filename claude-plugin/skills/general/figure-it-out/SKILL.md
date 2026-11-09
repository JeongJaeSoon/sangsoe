---
name: figure-it-out
description: "Design an auditable playbook before code for a large migration or multi-part change, or work reviewed after the human steps away — /figure-it-out, \"알아서 설계해서 진행해줘\", \"자리 비운 동안 끝내줘\". Several tickets on their own sessions are a sangsoe program."
---

# Figure it out

When the task matches no narrower procedure, design one. The deliverable before any code is the workflow itself: a sequence of phases that scales rigor to the task, runs each unit as an experiment, and leaves a decision trail a human can audit after stepping away.

A **<name>** principle below is `references/principle-<name>.md` in the **principles** skill.

## Phase A: Frame

Ground first, then commit. Don't start the run until you can state:

- The definition of done as a falsifiable predicate (the **prove-it-works** principle), with what is deliberately left out (the **work-to-an-exit-condition** principle).
- Scope, quantified: rough units and effort, plus the blockers grounding surfaced.
- The rigor level, biased high. One-way doors and a wide blast radius get more. Reversible low-stakes steps get less. Rigor is gates and artifacts, not "try harder".

Write the framing and its tradeoffs where the human reads it: the PR body, the issue's plan comment, or the decision trail when there is neither. Reversible work proceeds without waiting (the **never-block-on-the-human** principle). A step that cannot be undone, such as a destructive migration or a backfill with no rollback, waits for one explicit approval at that step. Inside a sangsoe program, ask for that approval with the `decision_open` MCP tool, not a local prompt nobody watches.

## Phase B: Design the workflow

Split the work into atomic, independently landable units. Sequence the riskiest unknown first. Scaffold and verification come before features (the **foundational-thinking** principle).

- Build the verification check before the work, with the baseline captured from the pre-change state, so each check reads as "old value vs new value".
- For a one-way-door design decision, run the **architect** skill (it runs **fan-out** compete). Skip it for mechanical work whose shape is already concrete. A second compete round over a settled design is more than the job needs.
- Decide what fans out. Parallelize only across seams, and give each worker its own worktree or branch (the **separate-before-serializing-shared-state** principle). Don't over-fan. In-session workers are subagents (**fan-out**).
- Units that are separate tickets and should run in their own sessions become a sangsoe program: its lead starts each unit through the core start procedure (decision 94), with a Task, a Dispatch and a parent. Never open those sessions yourself with a raw start (`orca agent launch`, a Bash `orca orchestration worker-start`, a background `claude`). sangsoe's guard hook refuses them and names the MCP tool to use. A refused start (`start_refused`) is escalated to whoever gave you the work, not retried another way.
- Write the phase list into the plan from Phase A. That list is what the human reviews.

Then execute the design one unit at a time under the Phase C loop, adding a Phase D row as each unit lands rather than saving the trail for the end. Each unit is reviewed independently, committed, and merged through the repo's merge path. In a sangsoe repo that path is the land step, which checks the evidence the unit's verification tier asks for (V0 to V3, decision 85).

## Phase C: Run the loop

Each unit is an experiment. State the hypothesis, make the smallest change, measure against the predicate on the real artifact, keep it if it advanced, revert it if it didn't. Verify each unit before starting the next instead of batching checks at the end (the **sequence-verifiable-units** principle).

- Verify by inspecting the artifact, never a self-report. When something passes too easily, suspect the observation method before the system.
- Pair delegated work with a judge. If a worker games the check, reset and harden the contract. If the check itself is wrong, fix the check in its own change rather than routing around it.
- A verdict is VERIFIED, NOT VERIFIED, or INCONCLUSIVE. Inconclusive is not a pass. Don't hide a negative.

## Phase D: Keep the audit trail

Log the run with the **show-me-your-work** skill. Work of this size usually earns a committed trail, so the reviewer can read it in the PR. The trail plus the diff is what lets the human come back and trust the work.

## Phase E: Verify and hand back

Check the whole against the Phase A predicate on the real product, not only the check you built. Encode any recurring correction as a gate, a lint rule, a test, or a core function (the **encode-lessons-in-structure** principle).

**Reply:** the playbook you designed, the rigor level and why, where the decision trail is, what is verified against the predicate, and what is still open.
