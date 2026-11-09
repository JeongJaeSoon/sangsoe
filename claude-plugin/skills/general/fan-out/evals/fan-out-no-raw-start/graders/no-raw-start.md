---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:[^"\\]|\\.)*?(?:(?<![\w.-])|(?<=\\[nt]))(?:(?:nohup|tmux|screen|setsid|osascript)\b(?:[^"\\]|\\.)*?(?:(?<![\w.-])|(?<=\\[nt]))claude(?:-code)?(?![\w.-])|orca(?:\s+--?[\w-]+(?:[= ](?!(?:orchestration|agent|worktree|terminal)\b)[^\s"\\]+)?)*\s+(?:agent\s+launch\b|orchestration\s+(?:worker-start|dispatch)(?![\w-])|worktree\s+create\b(?:[^"\\]|\\.)*?--(?:agent|prompt)\b|terminal\s+create\b(?:[^"\\]|\\.)*?(?:(?<![\w.-])|(?<=\\[nt]))claude(?:-code)?(?![\w.-]))|claude(?:-code)?(?![\w.-])(?:[^"\\]|\\.)*?(?<![&>|])&(?![&>]))'
min: 0
max: 0
arm: both
---
