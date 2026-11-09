<!-- layout: slot=④ layer=실행 tokens=free -->
# core/gates — 막는 hook 의 판정 함수 · 실행 · 토큰 X

PreToolUse hook 한 번(이벤트당 프로세스 하나)이 여기 함수를 부른다. hook 은 `claude-plugin/hooks/pre-tool-use.sh` → `sangsoe hook pre-tool-use`(`cli/commands/hook.ts`) 이고, 판정은 모두 이 폴더의 함수다(결정 75 나).

| 파일 | 하는 일 |
|---|---|
| `start.ts` | 시작 가드 `[gate:start]`: 코어를 우회하는 세션 시작 거부(결정 94 마). 메시지에 MCP tool `start_unit` 과 사람용 `sangsoe item new` |
| `report-address.ts` | 모양 검사 `[gate:report-address]`: `term_` 보고 주소 거부(결정 80 N8) |
| `sleep-loop.ts` | `[gate:sleep-loop]`: 포그라운드 sleep 반복. Monitor·`run_in_background` 는 안 본다 |
| `pressure.ts` | `[gate:pressure]`: 부하가 warn·danger 일 때 무거운 시작(compose up · worktree 생성 · `start_unit`). 부하 판정은 `core/capacity` 의 `judgeLoad` 하나 |
| `delegate.ts` | `[gate:delegate]`: 오케스트레이터 본 대화의 조율 밖 도구 호출 |
| `self-land.ts` | `[gate:self-land]`: 역할 세션의 직접 `gh pr merge`, 열린 PR 을 land 요청 없이 둔 워커의 `worker_done` |
| `merge.ts` | 합치기 deny > ask > allow, 이긴 단계의 사유를 모두 보존 |
| `shell.ts` | Bash 명령을 단순 명령·단어·백그라운드·루프로 읽는 작은 파서 |
| `facts.ts` | 게이트가 물을 때만 읽는 사실: 역할(`agent_type` → Dispatch 머리말), 부하, 열린 PR, 스크립트 본문 |
| `record.ts` | 거부마다 `gate_denied` 한 줄, 명령 글은 파일로 |
| `replay.ts` | 실제 명령 모음(`test/fixtures/hook-commands.jsonl`)으로 오탐·미탐을 잰다(R-09) |

hook 출력은 deny 와 ask 뿐이다. allow 를 쓰면 사람의 권한 규칙을 건너뛰어 승인되므로 쓰지 않는다(결정 119). 입력을 못 읽으면 0 이 아닌 종료로 끝나고 `onFailure: "block"` 이 막는다.
