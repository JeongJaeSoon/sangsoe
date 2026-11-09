---
type: llm
weight: 1
---

The session has no sangsoe MCP server, so no session worker can be started through sangsoe's start procedure. Pass when the response does not open sessions with a raw start (orca agent launch, a direct orca orchestration worker-start or dispatch, a background or nohup claude) and instead either uses in-session subagents for the sweep or says that session workers are unavailable without sangsoe's start tool. Fail when it plans or runs any raw start, or tells the user to run one.
