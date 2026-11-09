---
name: reflect
description: "Use to learn from finished sangsoe work: turn a session's or program's mistakes into skill edits through three independent reviewers, or measure how a program went from its events — \"돌아보고 스킬에 반영해줘\", \"이 프로그램 회고해줘\", \"성과 측정해줘\", \"왜 재작업이 많았지\"."
---

# 돌아보기

두 가지다. **교훈**: 끝난 일에서 스킬·브리프를 고칠 거리를 찾는다. **측정**: 프로그램이 어떻게 됐는지 수로 본다. 둘 다 기록을 읽기만 한다. 고치는 것은 별도 PR 이다.

## 교훈

1. **재료.** 그 세션·프로그램의 기록을 resource `item_timeline`(항목마다 `sangsoe://item/<Task id 나 iNNN>/timeline`: 원문 → 분류 → 전환 → 증거 → PR·결정)과 PR 리뷰 원문에서 모은다. 기억으로 쓰지 않는다.
2. **리뷰어 셋.** 서로 다른 관점의 읽기 전용 서브에이전트 셋에게 재료만 주고 따로 묻는다: 무엇이 틀렸고, 어느 규칙이 있었으면 막았나. 너의 결론은 주지 않는다. 거부 문단(`write-brief` skill)을 지시문에 통째로 붙인다.
3. **거르기.** 한 번만 일어난 일은 교훈이 아니다. 서로 다른 두 번이 있어야 스킬을 고친다. 기계로 확인할 수 있는 규칙이면 스킬 문장이 아니라 hook·시험으로 제안한다.
4. **보내기.** 고칠 거리마다 어느 skill·agent 의 어느 절인지, 무엇을 바꾸는지, 근거 두 개를 적어 리드(없으면 오케스트레이터)에게 보낸다. 스킬 수정은 `write-skill` 순서를 따르는 별도 작업이다.

## 측정

event 를 `{model, effort}` 별로 읽어 아래를 센다. 재실행으로 초록이 된 main 실패도 따로 센다.

| 수 | 읽는 곳 |
|---|---|
| 완료 조건 N/M | 프로그램 항목과 증거 |
| 재작업(같은 항목의 PR 둘 이상, 머지 뒤 되돌림) | `item_timeline` |
| 머지 뒤 빨강(`main_red`)과 원인 PR | `item_timeline` |
| 후속 항목의 증가(NOW 로 생긴 항목 수) | `item_timeline` |
| 머지한 PR 하나당 토큰 | `item_timeline` 의 세션 기록 |

측정은 보고만 한다. 표 하나와 판단 한 문장으로 끝낸다.
