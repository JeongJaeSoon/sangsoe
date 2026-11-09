---
name: architect
description: "Sketch types, signatures and module structure before code, then stay in the loop as it fills in. Use for /architect, 'design this', \"상세 설계안 작성해줘\", \"설계안 다듬어줘\", \"구현 계획 짜줘\", or non-trivial work."
---

# Architect

Sketch types, function signatures, class shapes, and module boundaries with `not implemented` bodies and pseudocode. Compare more than one design, then fill in code against the chosen sketch.

A **<name>** principle below is `references/principle-<name>.md` in the **principles** skill.

## Phase A: Ground the problem

Build a real mental model of every system the new code touches. Run the **explain-code** skill's how mode over the relevant subsystems. Naming a file isn't grounding. Produce the architectural explanation the how mode prescribes. If the design redefines ownership or layering, also run its why mode on the existing shape so the rationale becomes a constraint, not a guess.

Skip Phase A only when the work is greenfield with no surrounding system to integrate.

## Phase B: Sketch

Run the **fan-out** skill in compete mode with the design-sketch task and the Phase A grounding. Pass `references/runner-prompt.md` as each runner's prompt, with the absolute paths of this `SKILL.md` and `references/rationale-template.md` so a runner can read them. Each candidate produces a design package shaped per `references/rationale-template.md`. A runner writing sketch files into the repo needs its own worktree.

When the caller limits model calls (a brief's MODEL CALLS line) and the contract is one boundary inside one system, write the candidates yourself instead of starting runners, and say so in the rationale. Run the compete round when the contract crosses systems or the caller asks for it.

Design it twice. Require at least two structurally distinct candidates before synthesis, even when the first looks sufficient (the **exhaust-the-design-space** principle). Compare whole-shape alternatives, not point fixes inside one shape.

Screen every candidate against [`references/design-red-flags.md`](references/design-red-flags.md) before synthesis. Assume the next contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. Prefer the design where a change that looks right from one file is right for the whole repo.

Compare viable candidates on interface depth. Prefer the design that hides more complexity behind a smaller, simpler public surface. A rich interface can keep call chains short by concentrating capability instead of scattering it across layers.

Compete returns one synthesized design package. Its synthesis decision fills the rationale's "Synthesis decision" section.

## Phase C: Agree (opt-in)

Default: implement the synthesized design with no human checkpoint. After synthesis, publish the plan page per [`references/plan-page.md`](references/plan-page.md), give its link with the numbered decisions and their defaults, and implement on the defaults. An unanswered decision is not agreement: that file says which ones to ask again and how to treat the answers.

Pause for sign-off only when the invoker asks for it: "/architect with checkpoint", "stop and show me before implementing", or similar.

The synthesis can ship as its own commit either way, as the "scaffold first" mode of the **foundational-thinking** principle. Planned breakage during fill-in is fine (the **outcome-oriented-execution** principle). For adversarial pressure on the design before implementing, run the **challenge** skill's interrogate mode on the synthesized sketch.

If the human pushes back on the shape, in a checkpoint or after the fact, treat that as Phase A evidence. Re-ground and re-run Phase B before writing more code.

## Phase D: Implement against the sketch

Replace `not implemented` bodies with code and pseudocode with logic. The synthesized sketch is the contract. Surface every deviation from it instead of absorbing it silently. If a function needs a parameter the sketch didn't anticipate, ask whether the sketch was wrong, the requirement was missed, or the implementation is overreaching.

## Phase E: Scrap when the architecture is wrong

If implementation keeps producing friction the sketch can't absorb, throw the sketch out. Don't bolt fixes onto a wrong design (the **redesign-from-first-principles** and **fix-root-causes** principles).

The signal is a pattern, not a single instance:

- The same shape of workaround appears repeatedly across unrelated code.
- Several unrelated edge cases all need special-case branches.
- Types need escape hatches (`any`, casts, optional fields always set in practice) to compile.
- The "we need a lock" reflex appears where the sketch said the state wasn't shared.
- Callers have to know the abstraction's internal rules to use it.
- Two or more independent Phase D deviations have the same shape.

A few edge cases don't condemn an architecture. Complexity in the data is not complexity in the design.

When you scrap:

1. Re-run the **explain-code** how mode over what's been built.
2. Redesign as if the new constraints had been day-one assumptions.
3. Subtract before adding (the **subtract-before-you-add** principle). The new sketch is smaller than the old one before it grows.
4. Return to Phase B.

## Outputs

Write the caller's usage first and derive the type sketch from it. Small changes get one file with new types and signatures. Larger work gets a module map plus type definitions. The rationale ships alongside, shaped per `references/rationale-template.md`, including the usage sketch, the synthesis decision and the numbered decisions, and is shown as the plan page per `references/plan-page.md`.
