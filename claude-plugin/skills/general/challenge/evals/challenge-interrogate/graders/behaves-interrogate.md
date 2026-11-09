---
type: llm
weight: 1
---

Pass only when the response (1) states the plan's intent, marked as assumed when the user gave none, (2) sorts its findings into the buckets Act on, Consider, Noted and Dismissed, with at least one Act-on or Consider finding specific to this plan, such as one shared key per endpoint serving one user's response to another, a single write invalidating every cached response for that endpoint so caches stampede or never stay warm, or 24-hour staleness for data other users changed, and (3) says which independent reviewers ran, or that none could. Fail when it approves the plan, gives only generic caching advice, or claims reviewers or agreement it does not show.
