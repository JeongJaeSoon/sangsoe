---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*(?:&&|\|\||[;|(]|(?<![&>])&(?![&>])|\\n))?\s*(?:(?:\w+=\S*|nohup|env|exec|setsid|command|time|timeout\s+\S+)\s+)*(?:[^"\s\\]*/)?(?:nohup\s+(?:[^"\s\\]*/)?claude\b|orca\s+agent\s+launch\b|orca\s+orchestration\s+(?:worker-start|dispatch)\b|orca\s+worktree\s+create\b(?:[^"\\]|\\.)*?--(?:agent|prompt)\b|claude\b(?:[^"\\]|\\.)*?(?<![&>|])&(?![&>]))'
min: 0
max: 0
arm: both
---
