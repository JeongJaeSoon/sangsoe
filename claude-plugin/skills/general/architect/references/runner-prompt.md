# Architect runner prompt

The architect session passes this file to every candidate runner in Phase B and fills in the variable inputs around it: the task, the Phase A grounding, the isolated working directory, and the path to write outputs. The working directory is a git worktree when available, otherwise a per-runner subdirectory under the sketch directory. What matters is that candidates are independent.

You are producing one candidate design in architect's parallel exploration. Read the **architect** skill in full first: that is the workflow you're inside. Output a candidate design package: type sketch, function signatures, module map, and prose rationale shaped per [`rationale-template.md`](rationale-template.md).

Apply the following discipline. The architect session compares candidates on these axes to pick a base. A **<name>** principle is `references/principle-<name>.md` in the **principles** skill.

- Caller's usage first. Write the README-style usage and two or three real call sites before the types, then derive the type sketch from them. The usage is the spec. Reconcile the sketch to the usage, not the reverse.
- Data structures first. Trace each dominant access pattern through the proposed structure. If the answer is "we'll add a map, index or cache later", the structure is wrong.
- Interface depth. Compare the capability hidden behind the public surface with the size of that surface. Prefer a simple interface that pulls complexity into the callee, even when the implementation becomes less simple. Keep transport and wire types off the public API. Parse into domain types behind the interface.
- Shared state. If two actors might both write, ask what happens. If the answer isn't "nothing", default to per-actor state with a merge at the read boundary (the **separate-before-serializing-shared-state** principle).
- Visible boundaries. Use `not implemented` errors for bodies, `// TODO` pseudocode for tricky logic, and doc comments stating intent and invariants. A reader traces data from input to output by reading types and signatures alone.
- Invariants in types (the **type-system-discipline** principle). Where a type cannot hold one, a runtime check beats a prose comment (the **encode-lessons-in-structure** principle).
- Validate at boundaries and trust types inside (the **boundary-discipline** principle). Business logic is pure functions. The shell stays thin.
- One source of truth per invariant. Derive instead of syncing.
- Idempotent state transitions where they apply (the **make-operations-idempotent** principle). Ask what happens if the operation runs twice or crashes halfway.
- Short call chains. If tracing the flow needs more than three files, flatten the hierarchy (the **minimize-reader-load** principle).

You are one of several runners. Produce the best design you can and don't hedge against the others. Differences between candidates are the signal used to pick a base and graft. Converging on a safe-looking middle defeats the exploration.
