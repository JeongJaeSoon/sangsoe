#!/bin/sh
# Run as `sh <this file> <event>` from hooks.json, so it needs no exec bit (decision 119).
# The recording hooks: they never block. The CLI is found the way pre-tool-use.sh finds it (decision 118).
# No exec: an older CLI on PATH that does not know the event exits 2, which Claude Code reads as "block"
# for UserPromptSubmit and Stop, so this script always ends with 0 whatever the CLI returned.
cli="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/../dist/cli/main.js"
if [ -f "$cli" ]; then
  node "$cli" hook "$1"
elif command -v sangsoe >/dev/null 2>&1; then
  sangsoe hook "$1"
fi
exit 0
