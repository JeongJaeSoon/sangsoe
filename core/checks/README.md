<!-- layout: slot=④ layer=실행 tokens=free -->
# core/checks — 시작 점검과 doctor

SessionStart 의 시작 점검과 `sangsoe doctor` 가 같은 목록(`START_CHECKS`)을 같은 함수(`runChecks`)로 돌리고 출력만 다르다: `startReport` 는 문제 줄만 내고 `fail` 이 하나라도 있으면 시작을 거부한다, `doctorReport` 는 항목마다 🟢/🔴 와 고칠 명령을 낸다. CLI 명령(`doctor`)은 설치 단위가 `core/install/` 에 둔다.

점검 하나가 파일 하나다. 새 점검은 `Check` 를 export 하는 파일 하나와 `index.ts` 의 `START_CHECKS` 한 줄로 더한다. 호스트 상태는 `CheckContext`(어댑터·exec·코어 버전)로 들어오므로 시험은 `test/fake-orca/` 로 돈다.

| 점검 | 실패하면 | 근거 |
|---|---|---|
| `orca-reachable` | fail · `orca open` | — |
| `orca-capabilities` | fail · Orca 갱신 | 결정 63 |
| `orca-commands` | fail · Orca 갱신 | 결정 63(어댑터 명령·옵션을 `agent-context` 와 대조) |
| `orca-hooks` | notice · `orca agent hooks on`(사람이 실행) | 결정 63 |
| `remote-hosts` | warn 한 줄 | 결정 88 ② |
| `claude-plugin-version` | warn · `sangsoe install` | 결정 90 |
| `orca-plugin-version` | warn · `sangsoe install` 또는 `sangsoe plugin approve` | 결정 90 |
| `orca-plugin-content`(doctor 만, `DOCTOR_CHECKS`) | fail · `sangsoe plugin approve`, 잴 수 없으면 warn | 결정 105·112 |
| `sqlite-version`(doctor 만, `DOCTOR_CHECKS`. 시작은 `Store.open` 이 같은 하한으로 거부한다) | fail · Node 갱신 | 결정 35 |
