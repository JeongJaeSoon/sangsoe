# Code quality review

Each reviewer applies this code-quality lens in addition to the rubric. It is a strict standard for implementation quality, maintainability, abstraction quality, and codebase health.

Be ambitious about code structure. Don't stop at local cleanup. Search for restructurings that keep behavior the same while making the implementation much simpler, smaller and more direct.

## Core prompt

Start from this baseline:

> Perform a deep code quality audit of the current branch's changes.
> Rethink how to structure and implement the changes to improve code quality without changing behavior.
> Improve abstractions and modularity, untangle control flow, and make the code shorter and easier to read.
> If there is a clear path that involves restructuring some of the codebase, propose it.
> Be thorough. Measure twice, cut once.

## Dimensions

Apply the ones that are relevant.

0. **Look for structural simplification first.** Look for reframings that make whole branches, helpers, modes, conditionals, or layers disappear. Often a move that uses the existing architecture better makes the change much simpler. If you can delete complexity rather than rearrange it, push for that.
1. **Don't let a change push a file from under 1,000 lines to over 1,000 lines without a strong reason.** Prefer extracting helpers, subcomponents, or modules. Waive it only for a structural reason where the resulting file stays clearly organized.
2. **Don't allow tangled growth in existing code.** Be suspicious of new ad-hoc conditionals, scattered special cases, or one-off branches inserted into unrelated flows. Treat them as a design problem, not a style nit. Prefer a dedicated helper, state machine, or module.
3. **Clean the design, don't just accept working code.** If behavior can stay the same while the structure becomes cleaner, push for the cleaner version. Prefer simplifications that remove moving pieces over refactors that spread the same complexity around.
4. **Prefer direct, boring code over clever code.** Treat brittle, ad-hoc, or hidden behavior as a problem. Be skeptical of generic mechanisms that hide simple data-shape assumptions. Flag thin abstractions, identity wrappers, and pass-through helpers that add indirection without buying clarity.
5. **Push on type and boundary cleanliness.** Question unneeded optionality, `unknown`, `any`, or cast-heavy code when a clearer type boundary could exist. Prefer explicit typed models over loosely shaped objects. If a branch leans on a silent fallback to paper over an unclear invariant, ask whether the boundary should be explicit.
6. **Keep logic in its canonical layer and reuse existing helpers.** Call out feature logic leaking into shared paths and implementation details leaking through APIs. Prefer the existing utility over a bespoke one.
7. **Treat needless sequential orchestration and non-atomic updates as design smells when the cleaner structure is obvious.** If independent work is serialized for no reason, ask whether it should run in parallel. If related updates can leave state half-applied, push for a more atomic structure.

## Output expectations

Report structural regressions and missed simplifications first, then tangled branching, then boundary, type, and file-size concerns, then smaller modularity and legibility issues.

## Approval bar

Do not approve merely because behavior seems correct. Treat these as blockers unless the author can justify them: the change keeps a lot of incidental complexity that a restructuring would delete, pushes a file past 1,000 lines, adds ad-hoc branching to an existing flow, scatters feature checks across shared code, adds an unneeded abstraction, wrapper, or cast-heavy contract, or duplicates an existing helper or puts logic in the wrong layer. Otherwise leave explicit, actionable feedback.

## Review tone

Be direct and demanding about quality. Don't be rude, and don't soften major maintainability issues into mild suggestions. If the code makes the codebase messier, say so. If the implementation missed an obvious simplification, say that too.
