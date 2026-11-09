---
name: verification-skill
description: "A verify-* skill drives the app like a user. Create: /create-verification-skill, \"verify 스킬 만들어줘\", a reusable verification harness in scope. Maintain: \"verify 스킬 점검해줘\", a periodic check, a verify-* skill that failed to drive a feature. Checking one change is not this."
---

# Verification skill

A project-local `verify-<app>` skill (`.claude/skills/verify-<app>/`) drives the real app the way a user does and captures evidence; its feature map says what to drive. Pick the mode, then read its file and follow it:

- **create**: no verify-* skill covers the app yet, and a reusable harness is asked for or in scope. Interview the repo, generate the skill and its feature map, and prove it end to end once. [references/create.md](references/create.md).
- **maintain**: a verify-* skill exists and may have drifted: a periodic check, a check of it, or a run that reported `verify skill stale: <feature>`. Read every feature from source, drive every feature live, and ship at most one PR of proven fixes to that skill's own directory. [references/maintain.md](references/maintain.md).

A verify-* skill that failed to drive a feature is repaired in maintain mode, not generated again; maintain with no verify-* skill to find stops and points at create.

## This skill builds the harness; the tier sets the depth

This skill does not decide how deeply a change is verified. In a repository sangsoe manages, that is the PR's verification tier, V0 to V3 (decision 85), computed from the diff: V0 needs required CI only, V1 adds the targeted test run's output, V2 adds output from actually running the changed behavior, and V3 adds screen evidence or a dev check and a human approval. From V2 up, output from a verify-* skill run on the PR's head is the evidence the tier asks for. So build and repair the harness here, and read the depth from the tier, never from this skill.

Proving that one change works is the delivery step of that change, which uses the verify skill and does not build or repair it unless that is in scope.
