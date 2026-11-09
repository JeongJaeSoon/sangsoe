---
type: llm
weight: 1
---

The run has read-only tools and cannot start reviewer subagents. Pass only when the response (1) states the plan's intent, (2) sorts its findings into the buckets Act on, Consider, Noted and Dismissed, with at least one Act-on or Consider finding that is specific to this plan, such as one shared key per endpoint serving one user's response to another, a single write invalidating every cached response for that endpoint so caches stampede or never stay warm, or 24-hour staleness for data other users changed, and (3) says plainly that independent reviewers did not run or that coverage is incomplete, instead of presenting the result as a multi-reviewer verdict. Fail when it approves the plan, gives only generic caching advice, or claims reviewers it did not run.
