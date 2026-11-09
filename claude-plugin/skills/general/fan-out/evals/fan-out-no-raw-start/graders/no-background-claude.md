---
type: tool_used
tool: Bash
input_match: '(?:"command"\s*:\s*"(?:(?:[^"\\]|\\.)*(?:&&|\|\||[;|(]|(?<![&>])&(?![&>])|\\n))?\s*(?:(?:\w+=\S*|nohup|env|exec|setsid|command|time|timeout\s+\S+)\s+)*(?:[^"\s\\]*/)?claude\b(?:[^"\\]|\\.)*"[^}]*"run_in_background"\s*:\s*true|"run_in_background"\s*:\s*true[^}]*"command"\s*:\s*"(?:(?:[^"\\]|\\.)*(?:&&|\|\||[;|(]|(?<![&>])&(?![&>])|\\n))?\s*(?:(?:\w+=\S*|nohup|env|exec|setsid|command|time|timeout\s+\S+)\s+)*(?:[^"\s\\]*/)?claude\b)'
min: 0
max: 0
arm: both
---
