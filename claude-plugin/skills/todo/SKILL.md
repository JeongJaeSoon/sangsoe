---
name: todo
description: "Owner's entry for what only the owner can do now in sangsoe (decisions to answer, approvals, owner items), from the core's owner_todo view. Run as /sangsoe:todo; the model does not invoke it."
disable-model-invocation: true
allowed-tools: Bash(sangsoe todo:*)
---

# 오너가 할 일

아래는 이 skill 을 부른 순간의 `sangsoe todo` 출력이다. 수는 현황 맨 위 "지금 오너가 할 일" 과 같은 `owner_todo` 뷰에서 나온다.

!`sangsoe todo`

## 할 일

1. 위 출력을 고치지 않고 그대로 보인다.
2. 행마다 오너가 할 행동이 하나다: 결정에 답하기(오케스트레이터 세션에 그 dNNN 으로 시작하는 줄로 답하면 바로 이어진다. 리드·워커 터미널에 친 답은 잇지 않는다, 결정 173), 승인, 명령 실행. 목록에 없는 일을 오너 몫으로 더하지 않는다.
3. 출력이 오류이면 오류 한 줄을 그대로 보이고 `sangsoe doctor` 를 권한다.
