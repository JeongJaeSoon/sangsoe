#!/bin/sh
# Run as `sh <this file> <event>` from hooks.json, so it needs no exec bit (decision 119).
# The recording hooks: they never block. The CLI is found the way pre-tool-use.sh finds it (decision 118);
# with no CLI the hook records nothing and exits 0, unlike the blocking hook, which holds every call.
cli="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/../dist/cli/main.js"
if [ -f "$cli" ]; then exec node "$cli" hook "$1"; fi
if command -v sangsoe >/dev/null 2>&1; then exec sangsoe hook "$1"; fi
exit 0
