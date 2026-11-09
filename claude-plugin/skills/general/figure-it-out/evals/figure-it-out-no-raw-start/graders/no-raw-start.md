---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*(?:&&|\|\||[;|(]|\\n))?\s*(?:(?:nohup|env|exec)\s+)*(?:nohup\s+claude\b|orca\s+agent\s+launch\b|orca\s+orchestration\s+(?:worker-start|dispatch)\b|orca\s+worktree\s+create\b(?:[^"\\]|\\.)*?--(?:agent|prompt)\b|claude\b(?:[^"\\]|\\.)*?(?<![&>|])&(?![&>]))'
min: 0
max: 0
arm: both
---
