# Why mode

Investigate the motivation and intent behind code. The how mode ([how.md](how.md)) answers what the code does and how it works. The why mode answers what forces led to its shape.

## Posture

Keep what you know apart from what you infer. `references/epistemics.md` has the confidence tiers and phrasing guide, and the synthesis must follow it.

## Step 1. Understand the target and the question

The **target** is usually a chunk of code, a pattern, a feature, or a named design decision. The **question** is usually a design rationale, a tradeoff, a motivating edge case, an external constraint, dead code, or a broad history sweep.

If the target is vague ("why do we do it this way?" with no clear referent), make your best guess from the conversation (open files, recent edits, what was just discussed). State your reading briefly so the user can redirect, then proceed.

## Step 2. Establish the code anchor

Before starting investigators, build the seed context yourself: file paths and line ranges, key symbols (functions, classes, constants), the last few commits touching the target, PR numbers from merge commits (pattern `(#1234)` in the subject line), and any linked issue keys.

- `git blame -L <start>,<end> <file>` for last-touch commits.
- `git log --follow -p -- <file>` for full history with patches through renames.
- `git log --oneline -20 -- <file>` for recent commits with PR numbers visible.
- `git log -1 --format=%B <commit>` to extract PR numbers.
- `gh pr view <number> --json title,body,author,createdAt,mergedAt,labels,closingIssuesReferences,comments,reviews` for each substantive commit's PR.

This anchor goes to every investigator and to the synthesis.

## Step 3. Pick the depth

**Narrow.** For a line, a constant, or a single commit ("why this line", "why is this timeout 30s"), where the blame, commit and PR chain from Step 2 already holds an explicit, cited answer, answer from git and `gh` alone. Say that you went narrow and which sources you didn't search, so the user can ask for the full sweep. Keep the confidence tiers and the output sections, drop the empty ones, and list the unsearched sources under What we don't know.

If the chain dead-ends (no PR body, "misc fixes", a squash with no description) or the question is about a design decision rather than a line, run the full investigation.

## Step 4. Start parallel investigators (full investigation)

### Sources

Pick sources from what this session can actually read. Each source maps to one evidence category and one playbook in `references/sources/` ([index](source-playbook.md)):

| Category | Source | Playbook |
|---|---|---|
| Source control history | git and `gh` (always available) | `code-archaeology.md` |
| Recorded decisions | sangsoe's `decision` resource and Orca Task text, when sangsoe's MCP server is connected | `connected-source.md` |
| Issue tracker | an issue-tracker MCP in this session's tool list | `connected-source.md` |
| Long-form documents | a documents MCP in this session's tool list | `connected-source.md` |
| Team chat | a chat MCP in this session's tool list | `connected-source.md` |

When infrastructure observability, error tracking, or product analytics has no connection in this session, don't start an investigator for it. List each in Sources consulted as not searched for lack of access, so the gap stays visible. If an MCP for one of those categories is in the tool list, give it an investigator with `connected-source.md`.

A calendar is not an evidence source. Use it only to narrow a date range (when a design review or incident call happened) and pass that range to the investigators.

Start one investigator for source control and one for each connected source with a target-specific lead, such as a linked issue, document, incident, person, or date. Each investigator owns exactly one source. Search a source with a plausible lead even when it may return nothing, and report an empty result. List every skipped connected source and the reason in Sources consulted.

Launch all investigators in a single message so they run concurrently. Each is an `Agent` call with `subagent_type: "general-purpose"` (it keeps MCP access). Tell each one in its prompt that it only reads: no file edits, commits, comments, messages, or issue changes, since the same MCPs can also write.

Each investigator gets:

1. The base prompt from `references/investigator-prompt.md`.
2. The playbook `references/sources/<source>.md` for its source.
3. The cross-cutting `references/sources/incident-postmortem.md` if the target code looks defensive (null checks, retry logic, timeout handling, rate limiting, feature flags, egress guards, OOM handlers).
4. The code anchor from Step 2, plus any date range.
5. The user's original question.

### What each category surfaces

Use this to know what to expect back and how to name a gap when a category returns empty.

- **Source control.** Always started, the only guaranteed source. Best at implementation-time rationale captured during review.
- **Recorded decisions.** Best at choices someone made on purpose, with the options they ruled out.
- **Issue tracker.** Best at the product or business reason. Strongest when the why is outside engineering.
- **Long-form documents.** Best at design rationale written out before it became code.
- **Team chat.** Best at deliberation that never reached a doc. Most useful when the git, issue, and doc trail is thin.

## Step 5. Synthesize

Once every investigator has returned, synthesize once. Do it yourself, or hand it to one `general-purpose` subagent, told it must not write files or change external state, when the findings are too large to hold alongside the conversation.

The synthesis works from:

1. The investigator findings, including null results and the sources skipped with their reasons.
2. The code anchor from Step 2.
3. The user's original question.
4. `references/epistemics.md`.
5. The template in `references/synthesizer-prompt.md`, including its quality check.

## Step 6. Present

Present the synthesis. You may lightly edit for clarity or add context from the conversation, but do not rewrite the confidence language.

## Output format

The structure is the one in `references/synthesizer-prompt.md`: The question, The code in question, What we found, What we can reasonably infer, Competing hypotheses, What we don't know, Sources consulted, Confidence summary. Adapt as needed, but keep the confidence separation intact, and keep Sources consulted as one line per source, including the ones that returned nothing or were skipped, with the reason.

After Sources consulted, if the user's question is a precursor to changing this code, turn the findings into a Preserve, Change, Avoid and Risk constraint set for planning the change.

## Failure mode to avoid

**Recency bias.** Assuming the most recent commit is authoritative. The current shape is often the accretion of many earlier decisions. Trace back.
