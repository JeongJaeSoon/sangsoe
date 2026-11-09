# Source playbooks

The why mode starts one investigator per available source. Each reads one playbook below.

| Category | Playbook | Source it documents |
|---|---|---|
| Source control history | [`code-archaeology.md`](./sources/code-archaeology.md) | git, `gh` |
| Recorded decisions, issue tracker, long-form documents, team chat | [`connected-source.md`](./sources/connected-source.md) | any MCP in this session's tool list that reads that category |

Cross-cutting:

- [`incident-postmortem.md`](./sources/incident-postmortem.md). Add it if the target code looks defensive (null checks, retry, timeout, rate limit, feature flag, egress guard, OOM handler).
