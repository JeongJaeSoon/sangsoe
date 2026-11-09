---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:[^"\\]|\\.)*?(?:(?<![\w.-])|(?<=\\[nt]))(?:nohup(?:[^"\\]|\\.)*?(?:(?<![\w.-])|(?<=\\[nt]))claude(?:-code)?(?![\w.-])|orca\s+agent\s+launch\b|orca\s+orchestration\s+(?:worker-start|dispatch)\b|orca\s+worktree\s+create\b(?:[^"\\]|\\.)*?--(?:agent|prompt)\b|claude(?:-code)?(?![\w.-])(?:[^"\\]|\\.)*?(?<![&>|])&(?![&>]))'
min: 0
max: 0
arm: both
---
