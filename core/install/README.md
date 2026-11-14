<!-- layout: slot=④ layer=실행 tokens=free -->
# core/install — 설치·갱신·제거

`sangsoe install`·`uninstall`·`doctor` 가 여기 있다(결정 90). 브루가 깐 트리 하나를 `claude plugin marketplace add`·`install` 과 `orca plugin dev load` 로 등록하고, 지울 때는 같은 셋을 거꾸로 부른다. sqlite 와 설정은 지우지 않는다. `orca plugin enable` 은 부르지 않는다: 승인은 `sangsoe plugin approve` 의 몫이다.

- `host.ts` — 밖과 닿는 것(명령 실행·파일 읽기·환경)을 `Host` 하나로 받는다. 시험은 가짜 `Host` 로 돈다. 트리 경로는 `SANGSOE_ROOT`(formula 래퍼가 `opt/sangsoe/libexec` 로 둔다), 없으면 `.claude-plugin/marketplace.json` 이 있는 상위 폴더.
- `install.ts` — 멱등. 지금 상태를 먼저 읽고 add/update, install/update 를 고르고, 새로 읽은 목록에서 꺼져 있으면 `claude plugin enable` 을 부른다(결정 166). 같은 단계를 Orca 가 새 세션에 쓰는 Claude 설정 디렉터리(`orca account list --json`)에도 그 `CLAUDE_CONFIG_DIR` 로 한 번 더 돌린다(결정 167). 설정 파일을 쓰는 것은 `--permissions` 하나다.
- `permissions.ts` — `sangsoe install --permissions`(결정 221). sangsoe 세션이 부르는 MCP 서버와 Orca 명령의 `permissions.allow` 규칙 목록(`SANGSOE_RULES`), 빠진 것만 더하는 diff·y/N·원자적 쓰기·백업, 더한 규칙의 기록(`~/.local/share/sangsoe/permissions.json`, 규칙 자체는 settings.json 에만), uninstall 의 되돌리기, doctor 의 `permissions` 행.
- `settings-json.ts` — settings.json 을 글자 단위로 이어 붙이고 떼어 낸다. 바꾼 칸 밖의 바이트(키 순서·다른 규칙·들여쓰기)는 그대로이고, 결과가 기대한 객체로 읽히지 않으면 쓰지 않는다.
- `stale-sessions.ts` — `sangsoe install` 의 마지막 목록(결정 247). `ps` 로 돌고 있는 sangsoe MCP 서버를 읽고, 진입점이 지금 가리키는 설치본의 `package.json` 보다 먼저 시작한 서버(또는 설치본이 없어진 서버)를 한 줄씩, 그리고 `claude --continue` 로 다시 띄우라는 한 줄을 낸다. 없으면 `stale sessions: none` 한 줄. 터미널에 쓰지 않고 아무것도 끝내지 않는다. 설치본을 읽는 `installedTree` 는 MCP 서버의 `server_stale`(결정 211)도 쓴다. `sangsoe install --stale-sessions` 는 이 목록만 찍는다.
- `doctor.ts` — 트리·Claude Code(점검한 설정 디렉터리 행과 Orca 가 고른 설정 디렉터리 행)·Orca 로드 상태 뒤에 `core/checks` 의 `DOCTOR_CHECKS` 를 같은 줄 모양으로 잇는다. 항목마다 `ok`·`FAIL`/`warn`/`notice`(고칠 명령과 함께, `FAIL` 만 종료 코드 1)·`not yet`(Orca plugin 을 싣지 않은 빌드의 `orca plugin` 줄만). `--offline` 은 트리만 본다(formula 의 `test do`).

Homebrew formula 는 이 저장소가 아니라 별도 탭 저장소에 둔다. OS 상주 작업(OS 스케줄러 등록)은 만들지 않는다.
