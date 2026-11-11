---
name: setup
description: "Use when sangsoe must be installed, updated or checked on this machine, or something looks unregistered or out of date — \"sangsoe 설치 점검해줘\", \"sangsoe 업데이트해줘\", \"새 PC 에 sangsoe 세팅\", \"plugin 이 안 보여\", \"버전이 안 맞아\". Points the owner at sangsoe doctor; the agent edits no settings."
---

# 설치와 점검

sangsoe 의 설치·갱신·점검은 사람이 터미널에서 돌리는 명령이다. 이 skill 은 어느 명령을 돌릴지 알려 주고, 결과를 읽어 준다. 에이전트는 설정 파일(Claude Code·Orca 설정, 권한 규칙)을 고치지 않는다. 권한 규칙은 오너가 돌리는 `sangsoe install --permissions` 가 diff 를 보이고 묻고 나서 쓴다.

| 상황 | 오너가 돌릴 명령 |
|---|---|
| 처음 설치 | `brew install JeongJaeSoon/tap/sangsoe` → `sangsoe install` → `sangsoe install --permissions` → `sangsoe plugin approve` → `sangsoe doctor` |
| 갱신 | `brew upgrade sangsoe` 다음 `sangsoe install`(doctor 의 `permissions` 행이 warn 이면 `sangsoe install --permissions` 도) |
| 무엇이 어긋났는지 보기 | `sangsoe doctor`(내려받기 없이 보려면 `--offline`) |
| sangsoe 세션이 권한 프롬프트에서 멈춘다 | `sangsoe install --permissions`. 바꿀 diff 를 보이고 y/N 을 묻는다. 두 번째 실행은 아무것도 쓰지 않는다 |
| Orca plugin 승인 | `sangsoe doctor` 가 가리킬 때만 `sangsoe plugin approve` |
| 지우기 | `sangsoe uninstall`. sangsoe 가 더한 권한 규칙만 빼고, 데이터와 설정은 남는다 |

## 하는 법

1. 오너에게 `! sangsoe doctor` 를 치라고 권한다. 느낌표로 시작하면 출력이 이 대화에 남는다.
2. doctor 의 `FAIL`·`warn` 행마다 그 행이 적은 고칠 명령을 그대로 전한다. 다른 명령을 지어내지 않는다.
3. 권한 규칙을 더해야 한다고 나오면(`permissions` 행), 오너에게 `sangsoe install --permissions` 를 터미널에서 직접 돌리라고 권한다. y/N 질문은 오너가 답한다. 그 밖의 설정을 바꿔야 하면 바꿀 내용을 보이고 오너가 직접 하게 둔다.
4. 에이전트 세션은 sangsoe 를 Bash 로 부르지 않는다. 이 skill 이 권하는 명령도 오너의 터미널 몫이다.
