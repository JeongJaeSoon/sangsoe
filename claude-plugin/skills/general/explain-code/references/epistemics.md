# Epistemics

How to reason about confidence when evidence is historical, fragmentary, and sometimes contradictory, and how to tell the user without flattening it into false certainty. Code shows what it does, not why it exists. The why lives in commits, PRs, issues, docs, and conversations, all incomplete, biased, and sometimes missing. Pretending otherwise produces confident-sounding guesses that mislead the user.

## Confidence tiers

Every claim in the output sits in one tier. The tier sets its section and its phrasing.

### 1. Direct

An explicit, textual citation answers the question: something an author actually wrote that says why, not "the code does X so the author must have wanted X". For example a PR description "this fixes the bug where users with more than 1000 items couldn't paginate", an issue "we're adding this because customer Acme requested it in their security review", a code comment "// clamp to 100 because the upstream API rejects larger values", a design doc "we chose option A over option B because we need persistence across restarts", or a chat message from the author "switching to this approach since the old one was flaky in tests".

Phrasing: confident, present tense, cited. "This exists because X."

### 2. Supported

Several pieces of indirect evidence converge on one conclusion. No single source states it, but the pattern across sources makes it likely. For example the PR title says "improve performance", the issue is labeled "perf", and the surrounding commits all touch the same hot path. Or several tests added with the change all exercise very large inputs.

Phrasing: confident but clearly derived, citing each item. "The evidence points strongly to X: [the specific pieces]."

### 3. Inferred

A reasonable reading of the context that nothing explicitly supports. It is your interpretation, not a fact from the record. For example the PR doesn't say why, but the error was happening in production (per the incident channel timing) and the fix merged the same day, so it was likely a hotfix.

Phrasing: hedged, with the chain explicit. "Given A and B, C seems likely because D."

### 4. Speculative

A plausible hypothesis on thin evidence, where other explanations fit equally well. Worth presenting, since the user may know which is right, but mark it as a guess. For example "This might be a workaround for a browser bug that's since been fixed, but we found no contemporary evidence of that."

Phrasing: "One possibility is X, but we have no direct evidence." It usually lives in Competing hypotheses.

### 5. Unknown

You looked and couldn't find out. A valid, important outcome. Document it.

Phrasing: "We searched X, Y, and Z and found no evidence of why." Be specific about what you searched: "We searched the issue tracker with keywords A and B, read the 6 PRs that touched this file since 2023, and grepped the repo for string literals matching the threshold. None gave a rationale."

## Phrasing guide

**Confidence words** imply Direct or Supported evidence and need a citation next to them. Never use them for inferences: "because", "the reason is", "was designed to" (claims author intent), "fixes", "addresses", "solves" (claims the change achieved its goal), "the team decided" (claims a group decision happened).

**Hedges** signal interpretation, not report. Use them in What we can reasonably infer: "appears to", "seems to", "likely", "suggests", "is consistent with", "one reading is", "plausibly", "may have been", "the evidence points toward".

**Words to avoid:**

- "obviously". If it were obvious, the user wouldn't be asking.
- "clearly". It almost always precedes a claim that isn't clear.
- "of course". Same.
- "just" (as in "it's just X for performance"). Dismissive, and it usually hides uncertainty.
- "I think" and "I believe". You're weighing evidence, not giving an opinion. Use "the evidence suggests".

## Avoid rationalization

Code that makes sense today may have been written for reasons that no longer apply, or that were wrong at the time. Don't retrofit a clean rationale onto messy history. Don't assume the author did the right thing and work backward to justify it. Don't assume a consistent pattern was intentional when it might be copy-paste. Don't turn an absence of evidence into evidence of absence ("no one mentioned security concerns, so it must not have been a concern").

## The sycophancy trap

Users often embed a hypothesis: "Why do we do it this way, I assume it's for performance?" Don't simply confirm it. Treat it as one candidate among others and check the evidence independently. If the evidence supports it, say so with citations. If not, say so, and present what the evidence does support.

## When evidence contradicts

Show both sources in the output, with citations. Don't pick the one that fits a tidier story. For example the issue says "we need this for customer X's compliance requirement" and the PR says "cleaning up tech debt in this area". Both may be true, or one may be wrong. Let the user make the call.

## When evidence is missing

An honest "we don't know" is one of the most valuable outputs. The user learns the answer isn't in the obvious places, that they'll need to ask a person (the original author, the product owner), or that the question isn't worth pursuing. Filling a gap with a confident guess harms the user, because they'll act on the guess. Name each gap concretely: the question, the sources searched, what you searched for in each, and what you found.

## Before finalizing

Before delivering, check every claim in What we found and What we can reasonably infer. Each claim has a citation or moves to Inferred or Hypotheses. Its phrasing matches its tier. It doesn't treat code as evidence for its own intent. The output has a What we don't know section. If it names no gaps, be suspicious.
