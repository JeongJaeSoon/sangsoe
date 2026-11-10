---
name: prune-comments
description: "Use to cut comments in a diff to what the code cannot say: /prune-comments, \"주석 정리해줘\", and the step before a diff goes to review. Docs and PR prose are write-plainly."
---

# Prune comments

A fresh reader prunes the comments in scope; you check its work and act on its flags. The author of a comment is the worst judge of whether it earns its place, so the pruner is a subagent.

## Scope

The caller's files or diff. Otherwise the current branch against its base plus the working tree. The base is the one the caller names, else the open PR's base branch, else the remote's default branch (`git symbolic-ref --quiet --short refs/remotes/<remote>/HEAD`, where `<remote>` is the current branch's upstream remote); if none resolves, say so and stop. The scope is `git diff $(git merge-base <base> HEAD)`, and every new file from `git ls-files --others --exclude-standard`, which that diff leaves out. Within a diff, the scope is the comments on added or changed lines, plus any nearby comment the diff made false. Untouched code elsewhere is out of scope, however noisy.

If the diff adds or changes no comment, and no existing comment sits beside the code it changed, say "no comments in scope" and stop.

## Steps

1. Save the working tree's state first, so the pruner's edits can be told apart from work already there: copy every in-scope file, tracked and untracked, to a scratch directory outside the repository. Then spawn one `Agent` (`subagent_type: "general-purpose"`, `model`: `subagents.judge` from resource `models`, `sonnet` without sangsoe's MCP server) with the scope and the absolute path of `references/pruner.md`. Its brief is that file; do not restate it.
2. Check the pruner's edits by comparing each in-scope file against its saved copy (`diff -u <copy> <file>`), never by the whole `git diff`, which also shows changes that were there before it ran. Revert only hunks the pruner made that change code rather than comments, or that fall outside the scope. Restore a deleted comment only when it matches a keep in the brief and you can point to the proof. If a report gets its facts wrong, rerun once with the error named; a second bad report means you finish the pass by hand and say so.
3. Act on each **RESHAPE** flag (a comment was explaining a surprise in our own code). A rename, an extracted function, or a type that fits inside the diff's files: do it now and run the tests. Anything larger is a follow-up: classify it NOW, LATER or DROP as the `principles` skill's Work to an Exit Condition says, and report it with its class.
4. Act on each **CONSTRAINT** flag (a comment claims a rule about our own code, like "do not remove" or "keep this order"). When the cheapest encoding the pruner named (a test, a type, a runtime assertion, a lint rule) fits inside the diff's files, add it, watch it fail when the rule is broken, then delete the comment. Otherwise keep the comment and report the constraint as unenforced.

## Report

The deletion count, the comments you restored and why, the reshapes done and left open, the constraints encoded, and the constraints still enforced only by a comment.
