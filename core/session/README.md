<!-- layout: slot=④ layer=감지 tokens=free -->
# core/session — 기록 hook 과 세션 이어가기 · 감지 · 토큰 X

Claude Code 의 기록 hook 일곱(`claude-plugin/hooks/record.sh` → `sangsoe hook <event>`)이 부르는 판정 함수와 MCP 기록 tool 둘(`handoff_save` · `review_ask_record`)의 코어다. 모두 막지 않는 기록자다: 무엇이 잘못돼도 0 으로 끝나고 아무것도 막지 않는다(막는 hook 은 U12 의 PreToolUse 하나). event 는 `core/store` 로만 쓰고 Orca 는 `core/orca` 어댑터로만 부른다. 형식을 못 읽으면 행동 0 이다.

**sangsoe 세션.** SessionStart 가 이 세션을 찾는다: `agent_type` 이 `sangsoe:<role>` 이거나, cwd 의 Orca worktree 에 끝나지 않은 Dispatch 가 있고 그 Task spec 첫 줄이 역할 줄(`sangsoe-role: <role>`, U10 의 `startUnit` 이 쓴다)이면 sangsoe 세션이고 `session_started` 를 쓴다. Dispatch 는 있는데 역할 줄이 없으면 `worker_stuck{no_role_line}`(결정 46). 둘 다 아니면 사람이 연 일반 세션이라 아무것도 하지 않는다. 뒤 hook 들은 Orca 를 다시 부르지 않고 그 세션의 `session_started` 줄만 읽는다(없으면 행동 0).

## hook → event

| hook | 읽는 입력 칸 | 쓰는 event | dedupe_key |
|---|---|---|---|
| SessionStart | `session_id` · `source`(startup·resume·clear·compact) · `cwd` · `agent_type` · `model`(compact 때만 옴, P9) | `session_started{session, role, model}`(entity=task, subject=`run:<Task 의 Run>`, target=`run:<쥔 Run>`) · `worker_stuck{no_role_line}` · 주입마다 `notified` | `session_started:<session>:<source>` · `worker_stuck:<task>:no_role_line` · 아래 주입 순서 |
| UserPromptSubmit | `prompt` · `prompt_id` · `transcript_path` | `owner_action{origin: chat}`(원문은 마스킹해 `owner_text`) · Dispatch 를 쥐지 않은 세션에서 줄이 `dNNN` 으로 시작하고 다른 결정을 적지 않았으면 U8 `decision_answer`(linked_by=hook, 결정 173) · `!` 입력(아래) | `owner_action:<session>:<prompt_id>` |
| Stop | `transcript_path` | `turn_ended{session, context_tokens}` · 이 세션의 열린 `waiting_human` 마다 `waiting_released{answered, evidence: turn_ended}` · `!` 입력 | `turn_ended:<session>:<prompt_id>` · `waiting_released:<seq>` |
| Notification | `notification_type` · `message` | `waiting_human{session, tool, excerpt}` + 소유 리드 `notify`(type `escalation`) | `waiting_human:<session>:<n>` · `notify:<task>:waiting_human:<seq>` |
| PostToolUse | `tool_name` | 같은 도구를 기다리던 `waiting_human` 의 `waiting_released{answered, evidence: tool:<tool>}` | `waiting_released:<seq>` |
| PostCompact | `trigger` · transcript 의 `compact_boundary.compactMetadata.preTokens` | `compacted{session, trigger, pre_tokens}` | `compacted:<session>:<prompt_id>` |
| SessionEnd | `reason` | 열린 `waiting_human` 마다 `waiting_released{moot, evidence: session_ended}` · `!` 입력 | `waiting_released:<seq>` |

어느 대기를 어떻게 푸는지(`by` 포함)는 `core/owner/release.ts` 의 `recordReleases` 가 정하고, hook 은 신호만 넘긴다(구현 결정 146). 오너의 말은 풀지 않는다(결정 91 ⑥).

**`!` 입력(결정 91 ⑥(1)(b), 92 (나)).** UserPromptSubmit · Stop · SessionEnd 가 transcript 끝 256 KiB 를 읽어 `<bash-input>` 사용자 줄과 그 자식(`parentUuid`) `<bash-stdout>…<bash-stderr>` 줄을 짝짓는다. 새 줄이 있으면 Orca 스냅샷을 한 번 읽고, 줄마다 마스킹한 `owner_action{origin: shell}`(`owner_action:<session>:<uuid>`)을 쓴 뒤 `ShellLine` 을 만들어 `core/owner` 의 `linkShell` · `recordShellLink` 에 넘긴다. 잇는 규칙(시각 · 저장소 · PR URL · 종료 코드 없는 줄 · 감시 명령)과 키(`evidence:owner_act:<uuid>` · `owner_act_unlinked:owner_act:<uuid>`)는 그쪽 하나다(구현 결정 134 · 146). Orca 가 답하지 않으면 아무것도 쓰지 않고 다음 hook 이 다시 읽는다. 상태는 바꾸지 않는다.

## SessionStart 주입 순서

stdout 의 줄이 그대로 세션 컨텍스트에 들어간다. sangsoe 세션이 아니면 아무것도 출력하지 않는다.

1. 역할 줄 `sangsoe-role: <role>` 과 Task · Dispatch · Run id 한 줄.
2. Run: `run-current` 가 Run 을 주면 그 Run, 비었는데 리드·오케스트레이터면 이 Task(오케스트레이터는 이 역할)의 지난 `session_started` 가 쥐었던 Run 으로 `orca orchestration run-use <id>` 를 하라는 한 줄.
3. 그 Run 우편함의 마지막 `handoff` 메시지 본문, 한 번만(`notified`, `notify:<run>:handoff:<msg>`).
4. 버전 어긋남 한 줄: 이 plugin 의 `plugin.json` 버전 ≠ 코어 버전일 때만.
5. 늦은 답: 이 Task 가 대기자인 답한 결정 중 `notify:<task>:dNNN`(U8 `answerNotifiedKey`)이 없는 것마다 `dNNN: <답>` 한 줄, 같은 키로 `notified`. 그래서 `/clear` 뒤 새 세션에는 다시 실리지 않는다.

## MCP 기록 tool

- `handoff_save{next, waiting, open_questions, reply_to}`: 네 칸이 모두 비지 않은 글(각 4,000자 이하)인지 검사하고 `run-current` 의 Run 우편함으로 `send --type handoff` 한다. sqlite 에는 쓰지 않는다(인계 본문은 Orca 메시지, 결정 80 N1).
- `review_ask_record{pr, reviewer, reminder?}`: `review_ask_sent` 한 줄. `~/.config/sangsoe/config.json` 의 `reviewers` 에 없는 리뷰어면 `unmapped_reviewer` 도 쓴다.

`restart_due`(뷰)는 `compacted`·`turn_ended` 에서 네 규칙을 계산한다: 자동 압축 3회 · 압축 뒤 첫 턴이 압축 전의 절반 이상 · 최근 두 압축 간격 30분 미만 · 토큰 상한.
