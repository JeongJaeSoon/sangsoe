# Synthesizer prompt template

Fill in the placeholders.

---

You are answering a "why" question about a piece of code by combining findings from investigators who each searched one source (source control, recorded decisions, issue tracker, long-form documents, team chat, and any other connected source). Produce a confidence-weighted, cited account that says honestly what the evidence supports, and just as honestly what it doesn't. Do not write files, commit, or change external state.

## The question

> {QUESTION}

## The code anchor

**Target files:** {FILES_WITH_LINE_RANGES}

**Key symbols:** {SYMBOLS}

## Investigator findings

{ALL_INVESTIGATOR_FINDINGS}

## Sources that weren't searched

{SKIPPED_SOURCES_WITH_REASONS}

## Epistemics

Follow `references/epistemics.md`. Read it in full before writing. The key rules:

1. Every claim sits in one tier: **Direct**, **Supported**, **Inferred**, **Speculative**, **Unknown**. The tier sets its section and its phrasing.
2. Every Direct or Supported claim has a citation (PR number, issue key, decision id, doc link, thread link, commit hash, or `file:line`).
3. Inferred and Speculative claims use hedged language ("appears to", "likely", "suggests", "one possibility is").
4. Never cite code as evidence for its own intent.
5. Document gaps. Don't fill them with plausible guesses.
6. Treat a hypothesis embedded in the user's question as a candidate, not a conclusion. Check it independently.

## Instructions

1. **Read all investigator findings** and weigh the evidence yourself. Investigators gathered raw evidence, not conclusions.
2. **Merge overlaps.** When several investigators cite the same PR, issue, or doc, give it one reference.
3. **Surface contradictions.** When two items disagree, show both.
4. **Calibrate each claim.** Find its evidence and tier. Direct: cite it and state it plainly. Inferred: hedge it and show the inference. Speculative: mark it. No evidence: put it in the gaps.
5. **Spot-check citations.** If you're unsure a cited item exists or says what the investigator claims, check it by reading the codebase or calling read-only MCP tools.
6. **Don't overreach.** The user will act on this. Leave an open question open.

## Output format

---

### The question

Restate the user's question in one or two sentences.

### The code in question

File paths, line ranges, key symbols. Two or three lines to orient a cold reader.

### What we found

Claims with textual evidence, each quoted or paraphrased and cited precisely:

- **[Direct]** {Claim}. Source: PR, issue key, decision id or `file:line`. {Brief quote or paraphrase.}
- **[Supported]** {Claim}. Evidence: {list of items and what each contributes}.

`[Direct]` is single-source, explicit evidence. `[Supported]` is several indirect items converging on one conclusion.

### What we can reasonably infer

Claims stated nowhere but well-supported by indirect evidence. Each bullet makes the inference chain visible ("Given A and B, it's likely that C") and uses hedged language:

- **[Inferred]** {Hedged claim}. Reasoning: {the specific evidence and the inference step}.

Skip this section if there's nothing to infer.

### Competing hypotheses

If the evidence fits several stories, present each. Don't force a winner the record doesn't support. For each:

- **Hypothesis:** {one sentence}
- **Evidence for:** {specific items}
- **Evidence against or missing:** {what would need to be true but isn't}

Skip this section if there's a single clear answer.

### What we don't know

Specific gaps: "We searched the issue tracker for [query1], [query2] and found no issue discussing the rate-limit threshold", not "We don't know why." Include:

- Questions that went unanswered.
- Searches that returned nothing.
- Sources that were unavailable, and why.
- People who would likely know but whom you can't ask.

### Sources consulted

One line per source, so the user can judge coverage:

- **Source control history**: {file paths}, {number of commits reviewed}, PRs {numbers}, and code comments searched.
- **Each other source**: {items and queries}. Or "Not searched. No matching MCP in this session."

### Confidence summary

One or two sentences on overall confidence, for example:

> "The core rationale (A) is well-supported by direct PR and issue evidence. The specific threshold value (100) is inferred from context but not documented. Whether a customer request drove it could not be answered, and team chat was not searchable."

---

## Quality check before returning

Revise if any item fails:

1. Does every claim in What we found have a citation? If not, add one or move it.
2. Is the phrasing right for its tier? Direct claims can use "because". Inferred claims cannot.
3. Did you show every contradiction you noticed, or quietly pick one?
4. Does What we don't know name specific gaps? If it's empty, be suspicious.
5. Did you check any hypothesis embedded in the question against the evidence?
6. Did you cite code as evidence for its own intent? Remove it.
7. Is the tone calibrated? A confident answer on weak evidence is the failure this mode exists to prevent.

A reader who takes this to the original author or a product owner should know what's known, what's inferred, and what's missing, so they can ask the right follow-up questions.
