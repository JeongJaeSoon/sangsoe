---
name: principle-guard-the-context-window
description: "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads."
disable-model-invocation: true
---

# Guard the Context Window

**Why:** Context overflow degrades reasoning quality, creates compression artifacts, and halts progress.

**Pattern:**
- **Route bulk elsewhere.** Send large reads, wide searches, and long command output to a subagent or a file, and keep only the summary and the path in the main thread.
- **Read what you need.** Read the part of a long file you need, not the whole file, and do not read the same file twice when the first read still holds.
- **Size phases and cap scope.** Limit files per phase, set turn budgets, account for mechanism costs.
