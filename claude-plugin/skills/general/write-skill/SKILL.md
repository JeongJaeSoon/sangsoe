---
name: write-skill
description: "Use before writing or changing a skill, agent definition or CLAUDE.md-style file, and before committing it — \"스킬 만들어줘\", \"스킬 고쳐줘\", \"write a skill\"."
---

# Write or update a skill

A skill change is not done when the text reads well. It is done when it has been checked against the skills already there, audited, scrubbed, tested, merged where sessions load it, and reloaded. This skill carries those steps so none is skipped.

## 0. Which target

- **A plugin in a public repository** (sangsoe's own `claude-plugin/` included): edit on a branch in its own worktree, never in the checkout sessions load. No company-internal or personal names in any file, commit message or PR body (§4).
- **The user's own skills, agents and instructions** (`skills/`, `agents/` and `CLAUDE.md` in the user's Claude config directory, `~/.claude` unless `CLAUDE_CONFIG_DIR` names another): edit in place, after copying each file to a dated backup outside that directory, since these are usually not under git. Workplace names are allowed there.
- **Another plugin you do not own**: not edited here. Record the change it needs for its owner.

Content moving from a personal file into a public repository is rewritten in generic terms first.

## 1. Fold in before adding

Before a new skill, or a new section longer than about ten lines, look for its home:

1. List what exists: the target plugin's `skills/` tree (in sangsoe, `claude-plugin/skills/` and `claude-plugin/skills/general/`), the `skills/` and `agents/` folders of the user's Claude config directory, and the skills this session lists as available.
2. Grep the topic's key terms across those directories' `SKILL.md` and agent files.
3. A skill that already owns the moment (its description names the trigger) gets the change. A new skill only when no existing one is a real home and the need recurs.

Say in the report which skills you checked and why the change went where it did. Drafting a new skill from scratch, or tuning a description that fails to fire, goes through a skill-creator skill's draft and test loop when this session lists one (its plugin prefix varies); without one, draft here and use the §5 eval as the test loop. Steps 3 to 7 follow either way.

A skill that adds a periodic job or a long-running process takes the built-in feature first: what Orca already does, then what Claude Code already does, and only then code of its own. It never adds an OS-level job such as a LaunchAgent.

## 2. Edit

Match the target's conventions: frontmatter `name` and `description` (the description carries the user's trigger phrases), and the body in the language the file already uses. Every description shares one listing budget (§5), so a longer one can push another skill's description out of the listing; add a trigger phrase only when it is needed. A command, flag or term you change gets grepped across the whole target, and every copy changes in the same commit. Cut any sentence the change makes redundant; prefer rewriting a sentence to adding one. Prose follows the `write-plainly` skill.

A skill folder holds prompts only. In sangsoe, `test/layout.test.ts` fails when a token-using folder such as `claude-plugin/skills/` holds a code file. A repeated calculation belongs in a core function, and a rule that must hold belongs in a hook; the skill names the command that reaches them.

A reusable skill holds no company-internal or project-specific information: no company, team, channel, person, ticket key, internal repo or service name, and no fact that is true for one project only. Write the rule in general terms; a one-project fact goes to that project's notes or memory. The user's own files may name their workplace where the workflow is theirs, but a one-project fact still does not belong in a skill.

## 3. Prompt audit

Run the `claude-api` skill's `prompt-audit` on the changed files: invoke the skill with the args `prompt-audit` and name the changed files in the request. It returns a findings report (`file:line`, pattern, why, confidence) and a proposed diff. Apply the findings that hold for this text, leave the ones on its keep list, and keep one line per finding for the report: applied, or not applied with the reason. A personal-file change is audited the same way.

## 4. Internal-name grep (public repository only)

Keep the pattern list outside the repository, one pattern per line, at a path the owner chooses. If there is none, stop and ask the user for it; never write the list into the repository.

```bash
git add <changed paths>
git diff --cached | grep -n -i -E -f <names-file>; echo "hits: $?"
git log -1 --format=%B | grep -i -E -f <names-file>   # after committing
gh pr view <n> --json title,body -q '.title+"\n"+.body' | grep -i -E -f <names-file>   # after creating or editing the PR
```

`hits: 1` (grep found nothing) is the pass. Any hit is rewritten generically, then the grep runs again. Show the command and its output in the report.

The list only finds names already on it, so read the diff for the rest: a home-directory path, a chat channel or user id, a ticket key, a company tenant host, a name for one setup's plugin or tool (add it to the list), narration of this machine's state ("this PC has…"), a private rule or one person's habit written as general, a quoted utterance.

## 5. Tests and validation

- The repository's own suite. In sangsoe that is `npm test`, which runs `test/layout.test.ts` (no code in token-using folders, every labelled README in `docs/architecture.md`). A new skill also gets a row in its folder's `README.md` table.
- `claude plugin validate <plugin dir>` once the plugin has a manifest (`.claude-plugin/plugin.json`).
- A test that needs a fake secret builds it by concatenation (the `<NAME>=` prefix and the value as separate strings): text shaped like a credential assignment can be masked to `[REDACTED]` on its way into the file. Grep the written file for `REDACTED`.
- **Description evals.** Every skill has `evals/<case>/` beside its `SKILL.md`: a `prompt.md` that should fire the skill with a grader `fires-<skill>.md`, and at least one case whose prompt should not fire it with a grader at `min: 0` and `max: 0`. Graders are `type: tool_used`, `tool: Skill`, an `input_match` on the skill name, and `arm: both`. Run them with the skill directory as the plugin target, since `claude plugin eval --eval-dir` refuses a directory under `skills/`:

  ```bash
  claude plugin eval <plugin>/skills/<path>/<skill> --ablation none --no-publish --trust-plugin \
    --runs 3 --output-dir "$TMPDIR/<scratch>/<skill>" --report "$TMPDIR/<scratch>/<skill>.html"
  ```

  Pass `--output-dir`, or the results land in `<skill>/evals/results/` inside the repository. It exits 1 when a case scores under the threshold (default 1.0). When a description changed, run the same command on the old version too (a worktree of the base branch) and compare the two tables. With the skill directory as the target only that skill is loaded, so a grader that says "a neighbouring skill did not fire" proves nothing there; the negative case is what tests the description's precision.
- Eval runs load no user settings, so a personal skill or a `CLAUDE.md` mapping that takes the same phrase never shows there. When one could, also run the phrase through `claude -p "<phrase>" --output-format stream-json --verbose --no-session-persistence --permission-mode dontAsk` in an empty git directory with user settings, and count the `Skill` tool calls. The skill listing has a budget of about 1% of the context window, counted in display width (a CJK character costs two); past it, the least-used skills lose their descriptions first. `claude -p "/skill-doctor"` shows which skills are out of the listing and their use counts, and `claude -p … --debug-file <f>` the over-budget total ("Skill listing over budget").
- An agent definition changed: a subagent started from the session that edited it still runs the old text. Check from a fresh `claude -p` session that delegates to the agent and asks it to quote a line only the new text has.

## 6. Merge

A public repository's change goes in by pull request, through that repository's own merge path: in a sangsoe program, the program's land step, never a hand merge. Commit signed, in the log's message form, with what was ruled out when a design choice was made. A change in the user's Claude config directory has no merge; say in the report that it applies on this machine only.

## 7. Reload

A running session keeps the old text until it reloads. Once the change is where sessions load it, ask the user to run `/reload-skills` (a `SKILL.md` or reference file changed) or `/reload-plugins` (a hook or the plugin manifest changed) in the sessions that need it. Changes to the user's own agent definitions or `CLAUDE.md` apply to sessions started after the change; say so.

## Report

- Target, files changed, commit sha and PR.
- Where the change went and which existing skills were checked (step 1).
- Prompt audit: findings count, each applied or not with the reason.
- The internal-name grep command and its output.
- Tests, validation and each eval command with its summary table.
- The reload the user still has to run, and in which sessions.
