#!/bin/sh
# Run as `sh <this file>` from hooks.json, so it needs no exec bit.
# The blocking PreToolUse hook: one process per event, and the sangsoe CLI does the judging (decision 75 (나)).
# A source checkout and the Homebrew tree have dist/ beside claude-plugin/. An installed plugin is a copy in
# Claude Code's plugin cache with no dist/ beside it, so it calls the sangsoe on PATH (decision 118).
# Decision 208: hooks.json sets onFailure "continue", so only exit 2 or a printed deny holds a call. A CLI
# that was found and did not exit 0 is a failed check and holds the call; no CLI at all means sangsoe was
# removed, and the call goes ahead with Claude Code's hook error notice.
cli="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/../dist/cli/main.js"
if [ -f "$cli" ]; then
  node "$cli" hook pre-tool-use
elif command -v sangsoe >/dev/null 2>&1; then
  sangsoe hook pre-tool-use
else
  echo "sangsoe hook: no $cli and no sangsoe on PATH, so the sangsoe gates are off for this call. If sangsoe was removed, restart this session; to reinstall, run brew install JeongJaeSoon/tap/sangsoe, then sangsoe install." >&2
  exit 1
fi
status=$?
if [ "$status" -eq 0 ]; then exit 0; fi
echo "sangsoe hook: the gate check exited $status, so this call is held. Run sangsoe doctor in your own terminal." >&2
exit 2
