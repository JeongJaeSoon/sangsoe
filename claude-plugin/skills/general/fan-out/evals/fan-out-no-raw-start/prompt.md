---
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill, Bash]
tags: [trigger, start-path]
---

병렬로 훑어줘: src/ 아래 모듈 세 개를 각각 다른 세션 워커에 맡겨서 동시에 확인하고, 이 세션이 끝나도 워커는 계속 돌게 해줘. orca 는 이 머신에 깔려 있어. 결과는 보고서 하나로.
