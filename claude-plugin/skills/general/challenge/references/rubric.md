# Review rubric

Review through whichever lenses are relevant. Not every lens applies to every change.

## Correctness

Does the code do what the intent says it should?

- Edge cases: empty inputs, null or undefined, boundary values, concurrent access.
- Error handling: are errors caught, propagated, or silently swallowed?
- Off-by-one, type coercion, integer overflow, string encoding.
- State management: race conditions, stale closures, dangling references.
- Do both the happy path and the sad path work?
- Idempotency: what happens if this operation runs twice, or if a previous run crashed halfway? If the answer is "it depends on what state was left behind", a reconciliation step is missing.
- Concurrency: if several actors can touch the same mutable state (files, branches, shared data), is access serialized by structure (locks, sequential phases, exclusive ownership), or by conventions that won't hold?

When you find a potential bug, trace the execution path. Don't just flag "this could be null". Show the call chain that makes it null.

## Root causes vs. symptoms

Is the code fixing the actual problem or papering over a symptom?

Answering this often requires looking beyond the changed files. Read the surrounding code (callers, callees, type definitions, sibling modules) and understand the architecture the change lives in. Use Read, Grep and Glob to follow the call chain before judging whether the change addresses the right layer.

- Guard clauses that mask a deeper invariant violation.
- Retry logic that hides a broken contract.
- Type casts that silence a modeling error.
- A workaround: why is it needed, and what would a proper fix look like?
- A fix in module A that belongs in module B's contract.
- Instructions where structure would be better. If the fix is a comment saying "don't do X" or a convention someone has to remember, ask whether a type constraint, a lint rule, or a runtime check could make the wrong thing impossible.

## Structural integrity

Does the code fit the system it's part of?

- Boundary discipline: is validation at system boundaries, or scattered through business logic? Validate data once where it enters, then trust it internally.
- Abstraction level: is the code mixing high-level orchestration with low-level detail?
- Coupling: does this change add dependencies that make future changes harder?
- Data model fit: do the data structures match the actual access patterns?
- Bolted-on vs. integrated: if the new requirement had been known from the start, would the code look like this?
- Legacy dual paths: does the change add a new API while keeping the old one alive? With no external consumers, migrate callers and delete the old path in the same change.

Don't penalize simple code for lacking abstraction. Premature abstraction is worse than duplication.

## Verification

Can you tell that this code works from reading it?

- Are there tests? Do they test behavior or implementation details?
- Are there assertions or invariants that would catch regressions?
- If this is a bug fix, is there a test for the bug?
- If this touches an integration boundary, is the full path tested?
- Check the real thing, not a proxy. Code that checks liveness through a file's mtime or cached state instead of the actual value has a verification gap.
- For delegated or async work: does the code verify actual output, or does it trust self-reports and summaries?

## Complexity budget

Is the complexity justified by what the code accomplishes?

- Code that could be simpler without losing correctness or clarity.
- Abstractions that serve only one call site.
- Configuration or parameters for cases that don't exist yet.
- Dead code, unused imports, vestigial parameters.
- "Just in case" code paths with no current callers.
- Compatibility paths kept for a migration that is already done. Delete them.
- Does the user experience justify the complexity? Half-finished features are worse than missing ones.

Simpler is better unless simpler is wrong.

## Security

For each security finding, trace the input path through the code and show it.

- User input flowing to dangerous sinks (SQL, shell, eval, innerHTML) without sanitization.
- Authentication and authorization gaps in new endpoints.
- Secrets in code, logs, or error messages.
- Time-of-check to time-of-use gaps in security-critical paths.
