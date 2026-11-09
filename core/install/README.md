<!-- layout: slot=④ layer=실행 tokens=free -->
# core/install — 설치·갱신·제거

`sangsoe install`·`uninstall`·`doctor` 가 여기 있다(결정 90). 브루가 깐 트리 하나를 `claude plugin marketplace add`·`install` 과 `orca plugin dev load` 로 등록하고, 지울 때는 같은 셋을 거꾸로 부른다. sqlite 와 설정은 지우지 않는다. `orca plugin enable` 은 부르지 않는다: 승인은 `sangsoe plugin approve` 의 몫이다.

- `host.ts` — 밖과 닿는 것(명령 실행·파일 읽기·환경)을 `Host` 하나로 받는다. 시험은 가짜 `Host` 로 돈다. 트리 경로는 `SANGSOE_ROOT`(formula 래퍼가 `opt/sangsoe/libexec` 로 둔다), 없으면 `.claude-plugin/marketplace.json` 이 있는 상위 폴더.
- `install.ts` — 멱등. 지금 상태를 먼저 읽고 add/update, install/update 를 고른다.
- `doctor.ts` — 트리·Claude Code·Orca 로드 상태 뒤에 `core/checks` 의 `DOCTOR_CHECKS` 를 같은 줄 모양으로 잇는다. 항목마다 `ok`·`FAIL`/`warn`/`notice`(고칠 명령과 함께, `FAIL` 만 종료 코드 1)·`not yet`(아직 만들어지지 않은 부분). `--offline` 은 트리만 본다(formula 의 `test do`).

Homebrew formula 는 이 저장소가 아니라 별도 탭 저장소에 둔다. OS 상주 작업(OS 스케줄러 등록)은 만들지 않는다.
