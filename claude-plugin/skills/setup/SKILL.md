---
name: setup
description: "Use when sangsoe must be installed, updated or checked on this machine, or something looks unregistered or out of date — \"sangsoe 설치 점검해줘\", \"sangsoe 업데이트해줘\", \"새 PC 에 sangsoe 세팅\", \"plugin 이 안 보여\", \"버전이 안 맞아\". Points the owner at sangsoe doctor; edits no settings."
---

# 설치와 점검

sangsoe 의 설치·갱신·점검은 사람이 터미널에서 돌리는 명령 셋이다. 이 skill 은 어느 명령을 돌릴지 알려 주고, 결과를 읽어 준다. 설정 파일(Claude Code·Orca 설정, 권한 규칙)을 고치지 않는다.

| 상황 | 오너가 돌릴 명령 |
|---|---|
| 처음 설치 | `brew install JeongJaeSoon/tap/sangsoe` 다음 `sangsoe install` |
| 갱신 | `brew upgrade sangsoe` 다음 `sangsoe install` |
| 무엇이 어긋났는지 보기 | `sangsoe doctor`(내려받기 없이 보려면 `--offline`) |
| Orca plugin 승인 | `sangsoe doctor` 가 가리킬 때만 `sangsoe plugin approve` |
| 지우기 | `sangsoe uninstall`. 데이터와 설정은 남는다 |

## 하는 법

1. 오너에게 `! sangsoe doctor` 를 치라고 권한다. 느낌표로 시작하면 출력이 이 대화에 남는다.
2. doctor 의 빨간 행마다 그 행이 적은 고칠 명령을 그대로 전한다. 다른 명령을 지어내지 않는다.
3. 권한 규칙이나 설정을 바꿔야 한다고 나오면, 바꿀 내용을 보이고 오너가 직접 하게 둔다. 에이전트는 설정 파일을 쓰지 않는다.
4. 에이전트 세션은 sangsoe 를 Bash 로 부르지 않는다. 이 skill 이 권하는 명령도 오너의 터미널 몫이다.
