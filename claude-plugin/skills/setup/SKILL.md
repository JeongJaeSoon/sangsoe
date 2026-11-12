---
name: setup
description: "Use when sangsoe must be installed, updated or checked on this machine, or something looks unregistered or out of date — \"sangsoe 설치 점검해줘\", \"sangsoe 업데이트해줘\", \"새 PC 에 sangsoe 세팅\", \"plugin 이 안 보여\", \"버전이 안 맞아\". Points the owner at sangsoe doctor; the agent edits no settings."
---

# 설치와 점검

sangsoe 의 설치·갱신·점검은 오너가 터미널이나 Claude Code 의 느낌표 줄(`! <명령>`)에서 돌리는 명령이다. 이 skill 은 어느 명령을 돌릴지 알려 주고, 결과를 읽어 준다. 에이전트는 설정 파일(Claude Code·Orca 설정, 권한 규칙)을 고치지 않는다. 권한 규칙은 오너가 돌리는 `sangsoe install --permissions` 가 diff 를 보인 뒤에만 쓴다: 터미널이면 y/N 에 오너가 답해야, 느낌표 줄이면 오너가 diff 를 읽고 그 명령이 끝에 적는 `--yes` 줄을 돌려야 쓴다.

| 상황 | 오너가 돌릴 명령 |
|---|---|
| 처음 설치 | `brew install JeongJaeSoon/tap/sangsoe` → `sangsoe install` → `sangsoe install --permissions` → `sangsoe plugin approve` → `sangsoe doctor` |
| 갱신 | `brew upgrade sangsoe` 다음 `sangsoe install`(doctor 의 `permissions` 행이 warn 이면 `sangsoe install --permissions` 도) |
| 무엇이 어긋났는지 보기 | `sangsoe doctor`(내려받기 없이 보려면 `--offline`) |
| sangsoe 세션이 권한 프롬프트에서 멈춘다 | `sangsoe install --permissions`. 바꿀 diff 를 보이고 y/N 을 묻는다. 느낌표 줄은 터미널이 없어 묻지 않고, 아무것도 쓰지 않은 채 마지막 줄에 돌릴 `sangsoe install --permissions --yes`(준 `--scope` 도 그대로)를 적는다. 두 번째 실행은 아무것도 쓰지 않는다 |
| Orca plugin 승인 | `sangsoe doctor` 가 가리킬 때만 `sangsoe plugin approve` |
| 지우기 | `sangsoe uninstall`. sangsoe 가 더한 권한 규칙만 빼고, 데이터와 설정은 남는다 |

## 하는 법

1. 오너에게 `! sangsoe doctor` 를 치라고 권한다. 느낌표로 시작하면 출력이 이 대화에 남는다.
2. doctor 의 `FAIL`·`warn` 행마다 그 행이 적은 고칠 명령을 그대로 전한다. 다른 명령을 지어내지 않는다.
3. 권한 규칙을 더해야 한다고 나오면(`permissions` 행), 오너에게 `! sangsoe install --permissions` 를 치라고 권한다. 터미널에서 돌렸으면 y/N 질문에 오너가 답한다. 느낌표 줄이면 diff 와 함께 `nothing was written` 으로 끝나니, 오너가 diff 를 읽고 마지막 줄이 적은 `--yes` 줄을 다음 느낌표 줄로 돌린다. 그 밖의 설정을 바꿔야 하면 바꿀 내용을 보이고 오너가 직접 하게 둔다.
4. 에이전트 세션은 sangsoe 를 Bash 로 부르지 않는다. `--yes` 줄을 포함해 이 skill 이 권하는 명령은 오너가 터미널이나 느낌표 줄에서 돌린다.
