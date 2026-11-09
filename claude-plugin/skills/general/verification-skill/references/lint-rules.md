# Static checks for a verify-* skill

Read the skill's files against each rule below before you run it, and fix every finding. These are the checks a file can show; they never launch or drive the app. Report each finding as `path:line: rule: message`, using the rule ids below, so a maintain pass can compare runs.

| Rule id | What fails |
|---|---|
| `frontmatter` | `SKILL.md` does not open with a `name` equal to the directory name (`verify-<app>`) and a non-empty `description`. |
| `sections` | A `Launch`, `Doctor`, `Drive`, `Evidence` or `Cleanup` heading is missing, or exists only inside a code fence. |
| `state-secret` | A state-file path whose name looks like a secret file (`.env*`, `*.env`, `*secret*`, `*credential*`, `*token*`, `*password*`, `*.pem`, `*.key`, `id_rsa*`). A hook may refuse to read it. |
| `shared-latest` | A shared `latest` link, file or directory (`ln -s … latest`, `latest.json`, `…/latest`). It resolves to another agent's instance. Prose that says never to use one does not count. |
| `cleanup-arg` | A cleanup or teardown script that runs without being told which instance to remove: no required first argument (`${1:?}`, an argument-count check, a required option), or a fallback to a default instance. |
| `pattern-kill` | `pkill`, `killall`, or `kill` of PIDs found by `pgrep` or `lsof`, in a fenced block or a script. Kill the PID this run recorded. |
| `helper-mode` | A shell or Python script that is not executable, or a script `SKILL.md` never shows in a code span or fence. A `node x.mjs`-style script needs no executable bit. |
| `feature-index` | `features/README.md` is missing, a feature file it does not list, a link in it that points nowhere, or a feature file without its four H2 sections (`Sub-features`, `How to get to it`, `Driving it with`, `Gotchas`). |

These are line patterns: they catch the common shapes, not every way to write them. A rule that kept missing a real problem gets its pattern widened here, in the same PR that fixes the skill it missed in.
