---
name: reap-resources
description: "Use when a sangsoe session must clean up what it started or deal with leftovers: compose stacks, dev servers, scratch dirs, a reap_blocked or resource_leak report, the machine running out of room — \"띄운 거 정리해줘\", \"방치 리소스 정리해줘\", \"reap_blocked 왔어\", \"메모리 누가 먹고 있어\"."
---

# 자원 정리

정리는 둘이 나눠 한다. **당사자**(그 자원을 띄운 세션)는 끝나기 전에 자기가 띄운 것을 내린다. **REAPER**(토큰을 쓰지 않는 라운드)는 당사자가 이미 없을 때 끝난 일이 남긴 것을 치운다. 이 skill 은 당사자의 몫과, REAPER 의 보고를 받았을 때의 판단만 정한다. 정리 규칙 자체는 코드가 강제한다.

## 당사자의 몫

- **띄울 때 남긴다.** compose stack, dev server, 오래 도는 프로세스를 띄우면 `resource_record` 로 종류·id·이 Task 를 남긴다. REAPER 가 치우는 근거는 만든 쪽이 남긴 기록뿐이다.
- **확인한 턴에 내린다.** 검증·프리뷰용 stack 은 확인이 끝난 그 턴에 `docker compose -p <project> down` 으로 내린다. `-v` 는 붙이지 않는다.
- **내가 띄운 것만.** 프로세스는 이 세션이 띄우고 PID 를 기록한 것만 그 PID 로 끝낸다. 이름·패턴으로 고르는 kill, 라벨로 고르는 Docker 정리는 쓰지 않는다.
- **남겨야 하면** 이유와 기한을 `resource_record` 에 적는다.
- 파일은 지우지 않고 휴지통으로 옮긴다. worktree·터미널은 건드리지 않는다. worktree 는 REAPER 가 안전 검사 뒤에 지운다. 세션 터미널은 시작한 쪽이 `worker-release` 로 풀고, `start_unit` 이 만든 worktree 의 setup 셸은 REAPER 가 풀린 뒤 기록된 handle 하나로 닫는다(결정 202). setup 스크립트가 있는 저장소의 셸은 남고 `start_unit` 의 notes 가 그 handle 을 적는다: 오너가 확인하고 닫는다.

## REAPER 의 보고를 받았을 때

REAPER 라운드는 Orca plugin 의 타이머와 monitor 의 힌트가 부른다. 에이전트가 라운드를 부르거나 대신 지우지 않는다.

| 받은 것 | 뜻 | 판단 |
|---|---|---|
| `reap_blocked` | 지우기 전 검사가 막았다(열린 PR, 커밋 안 된 변경, 원격에 없는 커밋, 남은 listener, archive hook 실패, 다른 호스트) | 그 worktree 의 당사자나 리드에게 확인을 맡긴다. 사람 판단이 필요하면 오너 할 일로 올린다. 강제로 지우는 플래그를 쓰지 않는다 |
| `reap_blocked`{kind `repo`, `repo_unreadable`} | sangsoe 가 연 카드가 없는 저장소의 열린 PR 을 토큰이 읽지 못했다. 그 저장소의 카드는 남고 라운드는 멈추지 않는다(결정 207) | worktree 당사자의 일이 아니다. 그 저장소를 정리해야 하면 토큰 권한을 넓힐지 오너 할 일로 올리고, 아니면 둔다 |
| `resource_leak` | 기록 없는 자원이 있다(소유자 모름) | 누가 띄웠는지 찾을 수 있으면 그 당사자에게 기록을 남기게 한다. 모르면 오너에게 목록으로 보인다. 직접 지우지 않는다 |
| `pressure_high` | 머신 부하가 높다 | 새 무거운 시작을 미룬다. 끝난 일의 자원이 원인이면 그 당사자가 내리게 한다 |

## 하지 않는 것

- 휴지통을 비우지 않는다.
- 다른 세션이 띄운 자원을 그 세션 대신 내리지 않는다. 그 세션이 살아 있으면 Orca 메시지로 부탁한다.
