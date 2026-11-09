---
name: brief
description: "Owner's entry for the sangsoe status report (decisions needed, owner to-dos, in progress, on hold) as rendered by the core. Run as /sangsoe:brief; the model does not invoke it."
disable-model-invocation: true
allowed-tools: Bash(sangsoe brief:*)
---

# 현황

아래는 이 skill 을 부른 순간의 `sangsoe brief` 출력이다. 코어의 `renderMarkdown` 이 그린 표이고, 채팅·패널·상태 표시줄이 같은 수를 쓴다.

!`sangsoe brief $ARGUMENTS`

## 할 일

1. 위 출력을 **고치지 않고 그대로** 오너에게 보인다. 행을 합치거나 빼거나 다시 쓰지 않는다. 행의 상태는 증거가 정했고 보고자가 바꾸지 않는다.
2. 그 아래에 판단 한 문장만 덧붙인다: 지금 오너가 먼저 볼 것 하나와 그 이유.
3. 출력이 오류이면(명령이 없거나 실패) 오류 한 줄을 그대로 보이고, 오너에게 `sangsoe doctor` 를 권한다. 현황을 네가 지어 쓰지 않는다.

인자: `<묶음>` 은 묶음 상세, `<묶음> <항목>` 은 항목 상세다.
