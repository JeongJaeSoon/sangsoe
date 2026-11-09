# A connected source (decisions, issues, documents, chat)

Use this playbook for any source other than git that this session can read through an MCP server: sangsoe's recorded decisions, an issue tracker, a documents store, or team chat. Use only the read tools that server offers. Never post, comment, edit, or change a status.

## What each kind contains

- **Recorded decisions** (sangsoe's MCP `decision` resource, and the Orca Task text and messages a decision is attached to): the question, the options, the answer and who gave it, with its `dNNN` id. The record of a choice made on purpose.
- **Issue tracker**: issues with their motivation, parent and child issues, comments that record scope changes, labels that name the kind of reason (`customer-request`, `incident-followup`, `perf`), and linked PRs.
- **Long-form documents**: specs, design docs and postmortems, often written before the code.
- **Team chat**: deliberation that never reached a doc, usually in a thread near the date of the change.

## How to search it

1. **Start from the anchor.** If the seed commits or PRs name an issue key, document link, decision id or thread link, fetch that item first and read all of it, comments included.
2. **Search by keyword.** Use the feature name, the key symbol, the error string and the business term. Try several phrasings.
3. **Walk the links inside this source.** A child issue's parent, a decision's earlier `dNNN`, a doc's linked doc. A link into another source goes under Additional leads, not into your search.
4. **Use dates.** Narrow to the weeks around the commits in the anchor.

## What good evidence looks like

- A stated reason: "we need X because the upstream API rejects larger values".
- A recorded choice with its ruled-out options.
- A parent item named like an initiative, which ties the change to a goal.

## Pitfalls

- **Scope drift.** An item may have been reopened with a different scope. Read its whole history.
- **Template text.** A "why" section filled with boilerplate ("improve user experience") is not an answer.
- **Stale plans.** Old items often describe a plan that changed. Compare dates with the code's ship date.
- **No access.** An item you can't open is a gap. Record it, don't guess.

## What to return

For each relevant item: its id or link, title, the reason quoted verbatim, author and dates, and how it bears on the question.
