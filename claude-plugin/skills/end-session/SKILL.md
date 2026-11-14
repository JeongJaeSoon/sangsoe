---
name: end-session
description: "Use before a sangsoe worker or lead sends worker_done, or when the owner asks to end, close or hand off a session — \"세션 종료해줘\", \"마무리하고 보고해\", \"worker_done 보내기 전에\", \"인계 남겨줘\", \"end this session\". Tears down what this session started, then reports once."
---

# 세션 끝내기

끝은 세 단계다: 내가 띄운 것을 내리고, 남길 것을 남기고, 한 번 보고한다. 터미널·worktree 를 닫는 것은 Orca 와 REAPER 의 일이다. 네가 하지 않는다.

## 1. 끝내도 되나

- 워커: 브리프의 완료 조건마다 마지막 수정 뒤에 돌린 출력이 있다. PR 이 걸린 일이면 `land` 를 불렀다(예약 또는 `merge_on_approval`). 열린 PR 을 `land` 없이 두면 `[gate:self-land]` 가 막는다.
- 리드: 프로그램의 완료 조건마다 증거가 event 에 있다, 또는 오너가 중단을 지시했다.
- 오케스트레이터: 끝내지 않는다. 이 skill 은 오케스트레이터의 재시작 인계(4절)에만 쓴다.

못 채운 조건이 있으면 끝내지 않거나, 실패로 보고한다(5절). 실패를 성공처럼 쓰지 않는다.

## 2. 내가 띄운 것을 내린다

- 검증·프리뷰로 띄운 compose stack 은 `docker compose -p <project> down` 으로 내린다. `-v` 는 붙이지 않는다.
- 프로세스는 이 세션이 띄우고 PID 를 기록한 것만 그 PID 로 끝낸다. 이름·패턴으로 고르는 kill 은 쓰지 않는다.
- 남겨야 하는 자원은 이유와 기한을 `resource_record` 로 남긴다. 기록이 없는 자원은 REAPER 가 소유자를 몰라 치우지 못한다. Docker 가 아닌 것(checkout·등록·브랜치·파일·프로세스)은 패널의 "기록됨·오너 손" 에만 보이고 sangsoe 가 치우지 않는다. 내렸으면 `action: released` 로 남긴다(결정 240).
- 임시 파일은 브리프가 정한 임시 폴더째 휴지통으로 옮긴다. 변수로 만든 경로를 `rm` 하지 않는다.
- 거부 보고 파일(`orch-refusal/` 아래)은 치우지 않는다. 읽는 쪽이 읽은 뒤 휴지통으로 옮긴다.
- worktree 는 지우지 않는다. worker_done 전에 지우면 보고할 곳이 사라진다.

## 3. 남길 것

- 결정할 일, 조사 결론처럼 세션과 함께 사라지면 안 되는 것은 보고 본문에 쓴다. Orca 가 이미 가진 것(Task·Dispatch·메시지)은 옮겨 적지 않는다.
- 후속 일은 NOW · LATER(재검토 trigger) · DROP(이유) 제안으로 적는다. 항목을 만드는 것은 리드다.

## 4. 리드·오케스트레이터의 재시작 인계

압축이 잦아 `restart_due` 가 오거나 오너가 `/clear` 를 하려 하면, `handoff_save` 로 판단 상태 넷을 남긴다: 다음 할 일, 기다리는 답, 답 없는 질문, 오너 요청의 회신 경로. Orca 의 handoff 메시지로 네 Run 에 남고, 새 세션의 SessionStart hook 이 한 번 붙인다.

## 5. 한 번 보고

- 워커·리드는 Orca `send --type worker_done` 을 자기 Dispatch 로 **한 번** 보낸다. PR 이 걸린 일도 같다: 머지 대기 보고(`merge_ready`)는 이 본문에 담고 따로 보내지 않는다(결정 175). 본문: 바꾼 것, 완료 조건별 증거(실제 출력), PR·head·리뷰 판정·리뷰어(PR 이 걸린 일), 확인하지 못한 것, 거부된 행위, 후속 제안.
- 거부된 행위는 worker_done 까지 미루지 않는다. `write-brief` 의 거부 문단대로 같은 턴에 이미 escalation 으로 보냈고, 본문에는 그 파일 경로·범주와 그 때문에 확인하지 못한 것을 다시 적는다.
- 완료 조건을 못 채웠으면 실패로 보낸다(Orca 의 실패 결과). 남은 것을 적는다.
- 보낸 뒤 그 턴에 멈춘다. 다른 일을 시작하지 않고, 결과를 폴링하지 않는다. Orca 가 터미널을 해제한다.
