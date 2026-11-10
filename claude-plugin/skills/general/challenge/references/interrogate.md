# Interrogate

Have independent reviewers challenge the design or changes against the same prompt and rubric. Evidence and distinct reasoning matter more than model identity.

Select reviewers within the repository's data-sharing and permission boundaries. Read those restrictions first and include them in each review brief. If no permitted reviewer is available, report the review as unavailable rather than send code to a prohibited service.

The deliverable is a synthesized verdict. This skill changes no files. When another skill calls it, the caller applies the Act-on findings.

## Step 1. Scope

Identify what to review from context:

- If the user points at specific files or a diff, use that.
- On a feature branch, run `git diff main...HEAD` (or the right base branch) for the full changeset.
- If the user's message references recent work, gather the relevant files.
- If the target is a design, plan or decision rather than code, package that document and the code or constraints it rests on.

Package the diff or file contents with the surrounding context files the reviewers need to understand the code.

## Step 2. Intent

Before starting reviewers, state the intent in one paragraph from the user's message, commit messages, the PR description if one exists, and the code. If the intent is ambiguous, write your best reading and mark it as assumed, so the verdict can be re-read against it.

## Step 3. Start reviewers

Use independent read-only reviewers available in the authorized environment, as subagents of this session. Give each the same raw scope and rubric, never another reviewer's conclusions. Choose the number by the change's risk. Name each one's `model`: `subagents.judge` from resource `models` (`sonnet` without sangsoe's MCP server), or the `review` row for a PR headed to merge; never leave it to inherit the session's model. Record unavailable reviewers and incomplete coverage rather than claiming a pass.

Read `references/reviewer-prompt.md` and fill in the same template for every reviewer with the stated intent, the diff or file contents, the rubric from `references/rubric.md`, and the code-quality lens from `references/code-quality-review.md`. For a design, plan or decision, leave out the code-quality lens and add one line to the brief: the plan's premises are in scope, so reviewers may challenge the approach, not only its execution. The intent paragraph states the goal the plan serves.

## Step 4. Synthesize

Merge the reviewers' findings into one list. Different reviewers describe the same issue differently: merge those and note which reviewers raised each. A finding raised independently by two or more reviewers is the strongest signal. A single-reviewer finding still gets read, weighted accordingly. Where one reviewer explicitly contradicts another, keep both sides for the verdict and the Agreement Map.

## Step 5. Lead judgment

You are the lead reviewer, a pragmatic senior engineer, not a neutral aggregator. Read `references/lead-judgment.md` for the framework. Put every finding in one of four buckets, with the reviewers that raised it and a one-line rationale.

- **Act on.** Real issues affecting correctness, security, or maintainability given the actual goals. They would block a real PR.
- **Consider.** Legitimate, but you're not sure they outweigh the cost of addressing them now. Worth the user's attention.
- **Noted.** Technically valid but not actionable: context-dependent, premature optimization, or low-impact at this stage.
- **Dismissed.** Wrong, nitpicky, or missing context, with a brief reason.

## Output format

### Intent
> [The stated intent paragraph from Step 2]

### Reviewers
- Reviewer [label]: [reviewer identity], [N findings] (one bullet per reviewer)

### Act on
[Each: description, which reviewers raised it, why it matters.]

### Consider
[Each: description, which reviewers raised it, the tradeoff.]

### Noted
[Brief list.]

### Dismissed
[Each with a brief rationale.]

### Agreement map
[Where reviewers agreed and diverged, and what that pattern tells us.]
