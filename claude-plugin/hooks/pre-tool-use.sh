#!/bin/sh
# Run as `sh <this file>` from hooks.json, so it needs no exec bit.
# The blocking PreToolUse hook: one process per event, and the sangsoe CLI does the judging (decision 75 (나)).
# A source checkout and the Homebrew tree have dist/ beside claude-plugin/. An installed plugin is a copy in
# Claude Code's plugin cache with no dist/ beside it, so it calls the sangsoe on PATH (decision 118).
cli="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/../dist/cli/main.js"
if [ -f "$cli" ]; then exec node "$cli" hook pre-tool-use; fi
if command -v sangsoe >/dev/null 2>&1; then exec sangsoe hook pre-tool-use; fi
echo "sangsoe hook: no $cli and no sangsoe on PATH, so every tool call is held. In your own terminal, run npm run build in the checkout or install sangsoe; to stop the hook instead, run: claude plugin disable sangsoe" >&2
exit 2
