# 완성 계획: 남은 설계 틈의 분류·크기·단위 (2026-11-11, U50)

설계 전체를 짓는 것이 완성이다(오너). 이 문서는 오너가 적은 틈마다 설계가 약속한 것, main 에 있는 것, 분류, 크기, 그 틈이 들어갈 구현 단위를 적고, 단위 8개를 제안한다(브리프는 4–7개를 청했지만 P2 실측 추가분과 독립 검토의 "한 자리에 끝나지 않는다"는 지적으로 패널 단위를 둘로 나눴다. 7개여야 하면 U6b 와 U6a 를 한 워커가 차례로 돈다). 읽기만 했고 코드는 바꾸지 않았다. 분류 중 오너가 정한 것은 다시 열지 않는다.

크기: S 는 워커 하나 1시간 미만, M 은 1–3시간, L 은 3시간 넘음. 층: **토큰 X** 는 코어·hook·plugin worker 의 결정적 코드, **토큰 O** 는 에이전트 글(리드·워커·skill)이다.

## 1. 읽은 것과 전체 표

**읽은 커밋**: `origin/main` 4a77a43.

**읽은 파일**: `docs/decisions.md`(결정 11·40·83·88·92·125·158·173·176·177·186·187·188·191·192), `docs/design.html`, `docs/design-appendix.html`(hook 카드·REAPER 카드·Orca 표·가드 표), `docs/glossary.md`, `docs/test-outcomes.md`(P10·P11), `docs/research/design-review-2026-11-10.md`(B1·B2·N3–N10), `docs/research/stable-review-2026-11-11.md`(F7), `docs/dashboard/hallmark-final/group.html`·`README.md`, `core/reaper/{checks,round,docker}.ts`, `core/orca/{commands,adapter}.ts`, `core/contract/orca.ts`, `core/contract/events/*`(아홉 계약만 event·`evidence`·`worker_dead`), `core/detect/orca/{round,judge}.ts`, `core/detect/pr/round.ts`, `core/start/start.ts`, `core/verify/verify-tier.ts`, `core/models/table.ts`, `core/checks/claude-plugin-version.ts`, `core/install/doctor.ts`, `core/brief/{build,render,panel}.ts`, `orca-plugin/orca-plugin.json`, `orca-plugin/main.ts`, `orca-plugin/panel/{index,requests,view}.ts`, `claude-plugin/hooks/hooks.json`, `claude-plugin/mcp/recorder.ts`, `claude-plugin/agents/{lead,worker}.md`, Orca CLI 도움말(`worker-start`·`ports`·`worktree ps`·`worktree create`·`terminal create`), 공개 문서(advisor·settings·settings-reference·model-config·advisor tool·choosing-a-model·effort).

**결정 번호**: main 의 가장 큰 번호는 192 이고 189·190 은 비어 있다(188 다음이 191). 다음 빈 번호는 193 이며 아래 단위에 193–200 을 차례로 둔다. 실제 번호는 리드가 단위를 띄울 때 확정한다.

| # | 항목 | 분류 | 크기 | 단위 |
|---|---|---|---|---|
| 1 | 결정 176 의 다섯 hook 가드(위험 명령 · 남의 Orca 메시지 읽기 · 스택 PR · 실행 없는 "고쳤다" 주장 · 바닥 거부) | DROP(오너) | S | U1 |
| 2 | `SubagentStop`·`PreCompact` 원천 | DROP(오너). 이것이 필요한 설계 흐름은 없다(§3) | S | U1 |
| 3 | `StopFailure`·`PermissionDenied` 원천(결정 177) | DROP: Orca 의 escalation 과 겹친다. 이것을 먹는 일은 #9 | S | U1 |
| 4 | REAPER 삭제 전: Task 열림 / 세션 살아 있음 | NOW(오너) | S | U2 |
| 5 | REAPER 삭제 전: 증거가 worktree 밖에 아직 없음 | NOW(오너) | S | U2 |
| 6 | REAPER 삭제 전: listener 포트(Orca `ports`, 직접 탐지 없음. B3 도 이 행) | NOW(오너) | S | U2 |
| 7 | REAPER 삭제 전: 그 worktree 에서 띄운 compose stack | NOW(오너) | M | U2 |
| 8 | REAPER 의 열린 Task 루트(결정 177) | NOW | S | U2 |
| 9 | Orca escalation 소비: 오류로 멈춤 → `worker_dead{stop_failure}`, 프롬프트 대기 → 대기 event(B1) | NOW | M | U3b |
| 10 | 결정 186: `pr_review_requested`·`pr_changes_requested`·`review_commented`·`review_replied` 쓰는 쪽(pr-monitor) | NOW(오너) | L | U3a |
| 11 | 결정 186: `flow_step_skipped` 쓰는 쪽 | NOW(오너) | S | U3a |
| 12 | 결정 186: `worker_idle` 쓰는 쪽 | NOW(오너) | S | U3b |
| 13 | 결정 186: `observed_change` 쓰는 쪽 | NOW(오너) | M | U3b |
| 14 | 결정 186: `refusal_report` 쓰는 쪽 | NOW(오너) | S | U3b |
| 15 | 결정 186: `worker_done` 쓰는 쪽 | NOW(오너) | S | U3b |
| 16 | 아홉 event 를 brief·패널에 보이기 | NOW(오너) | M | U6b |
| 17 | 결정 173: `agent.prompt.before` 로 prompt 출처 표시 | NOW | M | U3b |
| 18 | 결정 125: "주석만" diff 파서 | (2026-11-11 오너가 잘랐다, 결정 203) 잘라내기 제안(§11) | L | — |
| 19 | 결정 88: 다른 PC | (2026-11-11 오너가 잘랐다, 결정 203) 잘라내기 제안(§11). 코드는 지어졌고 남은 것은 오너가 돌릴 P11 | S | — |
| 20 | U45 F7 의 N3·N5·N9·N10·S14 | 이미 끝남(U48, e18c1b4): 아래 §1.1 | — | — |
| 21 | 묶음 상세 화면의 빠진 부분(결정 92) | NOW | L | U6a |
| 22 | 묶음 0개일 때 보이는 것(안내 줄) | NOW | S | U6a |
| 23 | cwd 독립: 패널 `terminal create --worktree active` | NOW | S | U6b |
| 24 | cwd 독립: `start_unit` 의 cwd 검사 · 일반 폴더의 오케스트레이터 | NOW | M | U4 |
| 25 | cwd 독립: 그 밖의 cwd 추론(recorder · gate facts · hook locate) | NOW | S | U6b |
| 26 | 저장소를 건너는 `start_unit`(대상 저장소 입력, 계보 유지) | NOW | M | U4 |
| 27 | 패널 오류를 짧은 한국어 한 줄로 | NOW | S | U6b |
| 28 | v0.1.1: 사람이 보는 시각을 모두 UTC 로 그림 | NOW | S | U6b |
| 29 | v0.1.1: sangsoe Claude plugin 이 꺼져도 doctor 가 초록(설정 재작성으로 `enabledPlugins` 가 빠진 경우 포함) | NOW | S | U6b |
| 30 | advisor 를 사용자 설정 없이 전달(결정 187 ⑥) | NOW, 가능성은 조건부(§10, 먼저 잴 것) | M | U5 |
| 31 | 정책 행마다 effort, 오르는 trigger 에서 effort 한 단계 먼저(오너 추가 A1) | NOW | S | U5 |
| 32 | 일의 종류별 정책 행 여덟(오너 추가) | NOW | M | U5 |
| 33 | advisor 호출 상한과 비용 줄(오너 추가 A2) | NOW | M | U5 |
| 34 | ask/reply 를 코어 어댑터로(B2) | (2026-11-11 오너가 잘랐다, 결정 203) DROP 제안(§11) | — | — |
| 35 | 오너가 지켜보는 리드 터미널의 `--keep-open` 과 해제(B4) | NOW | S | U1(flag) · U4(시작) |
| 36 | 부르는 곳 없는 어댑터 행 아홉(B5) | NOW: 지운다 | S | U1 |
| 37 | U51 화면 대조 목록이 올 자리 | 자리만 | — | U6a |
| 38 | 보류 목록(`sangsoe isolate`, 상태 표시줄 글 꼴, 패널 위 빈 띠) | 계획하지 않음: 겹치지 않게만 | — | — |
| 39 | 모델 카탈로그 보기: CLI 보기 · 패널에서 닿기 · `table.ts` 에서 만든 `docs/models.md`(오너 추가) | NOW | M | U5 |
| 40 | P2 실측: 패널 띠(결정 0)가 상태 표시줄·`sangsoe todo`(결정 1)와 다르고 갱신 시각이 멈춤 | NOW | M | U6b |
| 41 | P2 실측: auto mode 가 워커의 `sangsoe land` 를 거부 → 허락 규칙 유무를 읽는 doctor 행(설정은 쓰지 않음) | NOW | S | U6b |
| 42 | P2 실측: 시작된 Task 의 `decision_open` 이 `task_not_startable` | NOW | S | U4 |
| 43 | P2 실측: 결정 subject 는 `item:iNNN` 인데 `start_unit` 의 spec Task 에 별칭이 없음 | NOW | S | U4 |
| 44 | P2 실측: 자기 Run 을 쥔 리드의 `handoff_save` 가 `dispatch_run_mismatch`, Dispatch 없는 escalation 이 `sender_not_assignee` | NOW | S | U4 |
| 45 | P2 실측: 취소한 Task 가 `failed` + 결과 `cancelled` 로 보임 | NOW | S | U6b |
| 46 | P2 실측: 비공개 저장소의 `gh repo clone` GraphQL 실패(`git clone` 은 됨) | (2026-11-11 오너가 잘랐다, 결정 203) DROP 제안(§11): sangsoe 코드에 `gh repo clone` 을 부르는 곳이 없다 | — | — |

### 1.1 F7 의 다섯 줄은 main 에 있다

U48(커밋 e18c1b4)이 닫았다. 확인한 자리: N3 는 `docs/design-appendix.html:743`(게이트는 명령 모양을 맞추고 못 읽은 입력은 통과), N5 는 `README.md:116`(선언한 두 읽기 능력과 실제 쓰기 둘), N9 는 `docs/test-outcomes.md` 의 T4 행(`<승인 id>`·`<내용 해시>` 자리표시), N10 은 `docs/decisions.md:401` 결정 158 머리 메모, S14 는 `docs/design.html:112`("끝은 `/goal` 이 아니라 Dispatch 와 `worker_done`")와 `docs/diagrams/perspectives.svg:64`. 남은 것: N5 의 README 는 "manifest 는 아직 맞추지 않았다"고 적는다. manifest 를 바꾸는 것은 U3b 가 `contributes.hooks` 를 더할 때 함께 본다.

## 2. 단위 순서

```
U1 ──┬── U2 (REAPER)
     ├── U3a (pr-monitor · flow)
     ├── U3b (Orca escalation · 세션 event · 출처)
     ├── U4 (시작과 계보) ───────────────────┐
     └── U6b (패널 읽기 · cwd · 시각 · doctor) ── U6a (묶음 상세) ─┴── U5 (모델 정책 · advisor)
```

- U1 이 먼저다: 설계 문서의 DROP 을 적고, 다른 단위가 쓰는 어댑터 행(`ports`, `worker-start` 의 `keep-open`·`repo`)을 더한다. 30분–2시간.
- U2 · U3a · U3b · U4 · U6b 는 서로 다른 파일을 만지므로 U1 뒤에 나란히 돈다. 겹치는 자리는 각 절의 "겹침"에 적었다.
- U6a 는 U6b 와 `core/brief/build.ts`·`orca-plugin/panel/` 을 나누므로 U6b 뒤에 돈다. U5 는 `core/start/start.ts` 를 U4 와, `orca-plugin/panel/index.ts`·`core/brief/` 를 U6a 와 나누므로 둘 뒤에 돈다.
- 가장 큰 단위는 U3b·U5·U6a 이고 각각 3–5시간으로 본다. 한 자리에 끝나지 않으면 각 절의 "먼저 잴 것" 뒤에서 끊는다.
- `docs/decisions.md` 는 모든 단위가 한 항목씩 더한다. 번호를 미리 나눠 주면 충돌은 끝줄 하나다.

## 3. U1 — 설계 정리와 Orca 어댑터 행 (M, 결정 193)

**항목**: #1 #2 #3 #35(flag) #36.

**설계의 약속과 main**:
- #1: 부록 `docs/design-appendix.html:754`(그 밖의 가드), `:770`(hook 구조의 바닥 거부), `:783`(실행 없는 주장 차단), `:268`(Stop hook 행), `:214`(Stop hook 카드)가 "짓지 않음(결정 176)"으로 남아 있다. 결정 176 은 `docs/decisions.md:471`. main 의 게이트는 `core/gates/index.ts` 의 여섯이고 이 다섯은 없다.
- #2: `SubagentStop` 은 Stop 옆에 놓였을 뿐(`docs/design-appendix.html:214`)이고, `PreCompact` 는 압축 전후 재주입의 앞쪽(`:271`)인데 뒤쪽 `PostCompact` 가 이미 재주입한다(`claude-plugin/hooks/hooks.json`). 서브에이전트의 모델은 결정 188 이 시작 글에서 밝히므로 멈춤을 볼 일이 없다. 그래서 두 원천이 필요한 흐름은 없다.
- #3: 결정 177(`docs/decisions.md:472`), 부록 `:217`·`:271`, 용어집 `docs/glossary.md:466`. sangsoe 는 Orca 의 escalation 을 지금은 먹지 않지만 먹을 수 있다: orca-monitor 가 이미 `orchestration inbox` 를 읽는다(`core/detect/orca/round.ts:53`, 판정은 `core/detect/orca/judge.ts:187` 부터, 지금은 `notified` 의 읽힘만 본다). 수신자가 아닌 쪽도 `inbox` 와 `check --all`·`--types` 로 메시지를 읽는다(훑기에서 확인). 그래서 두 hook 은 호스트 기능과 겹치고 DROP 이다. 먹는 일은 U3b 다.
- #36: 부르는 곳 없는 행 아홉, `core/orca/commands.ts` 의 `runCreate`(:41) · `runUse`(:42) · `ask`(:63) · `reply`(:64) · `workerRelease`(:75) · `worktreeSet`(:85) · `referenceList`(:92) · `search`(:94) · `terminalWaitIdle`(:95). 테스트 밖에서 부르는 곳이 없다. 에이전트는 이 명령을 글로 직접 부른다(`claude-plugin/agents/lead.md:38`, `claude-plugin/agents/worker.md:43`).

**하는 일**:
1. 결정 193 하나에 넷을 적는다: 다섯 가드를 설계에서 지운다(부록·용어집·`design.html` 에 "지켜진다"나 "짓지 않음(결정 176)" 문구를 남기지 않는다); `SubagentStop`·`PreCompact` 를 원천 목록에서 지운다; `StopFailure`·`PermissionDenied` 를 지우고 그 자리를 "Orca escalation 을 orca-monitor 가 읽는다(U3b)"로 바꾼다; 아홉 어댑터 행을 지운다.
2. 어댑터에 더한다: `ports`(`orca ports --worktree <selector> --json`, 읽기), `workerStart` 의 `keep-open` 과 `repo` flag. `ORCA_COMMANDS` 는 `orca-commands` 시작 점검이 대조하므로(`core/orca/commands.ts:17`) 새 flag 는 설치된 Orca 의 `agent-context` 에 있어야 한다. 이 셋은 지금 Orca 도움말에 있다.
3. `workerRelease` 를 지우는 대신 해제하는 쪽을 적는다: `keep-open` 으로 띄운 리드 터미널은 오케스트레이터가 리드의 `worker_done` 을 읽은 뒤 Orca CLI 로 해제한다(토큰 O, 오케스트레이터 글). REAPER 는 오너가 보는 터미널을 닫지 않는다.

**파일**: `docs/decisions.md`, `docs/design-appendix.html`, `docs/glossary.md`, `docs/design.html`(해당 줄만), `docs/port-map.md`, `core/orca/commands.ts`, `core/orca/adapter.ts`, `core/contract/orca.ts`, `core/orca/adapter.test.ts`, `test/fake-orca/*`, `core/contract/events/{refusal_report,worker_dead}.ts`(주석).

**시험**: 어댑터 표 시험(지운 행이 없고 새 행의 argv), 가짜 Orca 의 `ports` 응답 모양.

**층**: 전부 토큰 X(문서 · 어댑터). 재사용하는 호스트 기능: Orca `ports`, `worker-start --keep-open --repo`.

## 4. U2 — REAPER 삭제 전 검사와 Task 루트 (M–L, 결정 194)

**항목**: #4 #5 #6 #7 #8. 의존: U1(`ports` 행).

**설계의 약속과 main**: 용어집 `docs/glossary.md:21` 과 부록 `docs/design-appendix.html:228` 은 listener · compose · 증거 위치 · Task 닫힘 확인을 "짓지 않음(결정 176)"으로, 열린 Task 루트를 "짓지 않음(결정 177)"으로 적는다(`docs/glossary.md:26`, `docs/design-appendix.html:1019`, `:1034`). main 의 삭제 전 검사는 커밋 안 된 변경과 원격에 없는 커밋 둘이다(`core/reaper/checks.ts:13`). 정리 단계는 `preDelete` 뒤에 바로 `worktreeRm` 을 부른다(`core/reaper/round.ts:342`, `:348`). 루트는 `worktreeList`·`worktreePs`·`workerList` 와 `gh` 이고 Task 목록은 없다(`core/reaper/round.ts:15`).

**하는 일**: `preDelete` 앞에 넷을 더하고, 걸리면 `reap_blocked` 를 쓰고 지우지 않는다. 어느 것도 프로세스를 죽이지 않는다.
1. **Task 열림 · 세션 살아 있음**: `taskList`(이미 어댑터에 있다)로 그 카드의 Task 가 `completed`·`failed` 가 아니면 `task_open`. `worker-list` 의 liveness 가 살아 있으면 `session_alive`. 열린 Task 는 표시 단계의 루트로도 쓴다(#8, 결정 177 의 루트).
2. **증거**: `evidence` 행(`core/contract/events/evidence.ts`)의 `path` 가 그 worktree 안에 있으면 `evidence_in_worktree`. 증거 행이 sqlite 에 있다는 것은 worktree 밖에 있다는 뜻이므로 경로만 본다.
3. **listener**: `orca ports --worktree id:<id> --json` 이 행을 내면 `listener`. 직접 `lsof` 등으로 탐지하지 않는다(오너 추가 B3). **먼저 잴 것**: 터미널이 모두 닫힌 worktree 에서도 `ports` 가 그 worktree 에서 띄운 listener 를 보이는가. 보이지 않으면 결정 194 에 그 한계를 적는다.
4. **compose**: `docker compose ls --all --format json` 의 `ConfigFiles` 가 그 worktree 경로 안이고 실행 중이면 `compose_running`. Docker 데몬이 없으면 지금의 Docker 규칙처럼 건너뛴다(`core/reaper/docker.ts:11`). `down` 은 부르지 않는다. **먼저 잴 것**: worktree 에서 띄운 stack 의 `ConfigFiles` 가 실제로 worktree 의 절대 경로로 나오는가.
5. 읽기가 실패하면(`ports` 의 오류 포함) 지금처럼 모름(`unknown`)으로 세고 지우지 않는다. 데몬이 없어 건너뛰는 것은 Docker 쪽만이다.

**파일**: `core/reaper/checks.ts`(`BlockReason`), `core/reaper/round.ts`, 새 `core/reaper/live.ts`(포트·compose), `core/contract/events/reap_blocked.ts`(사유 넷), `test/reaper/*`. 설계 문서의 "짓지 않음(결정 176·177)" 자리를 지은 것으로 고친다(`docs/glossary.md:21`·`:26`, `docs/design-appendix.html:228`·`:1019`·`:1034`).

**시험**: 거부마다 하나(열린 Task, 살아 있는 세션, worktree 안 증거 경로, `ports` 행, 실행 중 compose), 그리고 읽기 실패가 모름이 되어 지우지 않음. 가짜 Orca 와 가짜 `exec` 로 돈다.

**층**: 토큰 X(REAPER 는 plugin worker 타이머 라운드). 호스트 기능: Orca `ports`·`task-list`·`worker-list`, Docker `compose ls`.

**겹침**: U1 의 어댑터 행만. U2 는 `core/reaper/` 밖을 만지지 않는다.

## 5. U3a — pr-monitor 리뷰 event 와 단계 건너뜀 (L, 결정 195)

**항목**: #10 #11. 의존: U1(문서 정리 순서만).

**설계의 약속과 main**: 결정 186(`docs/decisions.md:486`)이 넷을 pr-monitor 몫 "계약만"으로 적었다. pr-monitor 는 `pr_opened`·`pr_merged`·`close_suggested`·`item_transition` 등을 쓰고(`core/detect/pr/round.ts:172`, `:203`) 리뷰 event 는 없다. `flow_step_skipped` 는 GRAPH 가 읽기만 한다(`core/graph/facts.ts:158`). 부록은 그것을 에이전트 명령의 event 로, 이유 없는 건너뜀은 거부로 적는다(`docs/design-appendix.html:141`, `:548`).

**하는 일**:
1. pr-monitor 라운드가 열린 PR 마다 GitHub 의 requested reviewers · reviews · review comments 를 읽는다(이미 쓰는 `memoryGhCache` 의 ETag 아래). 새 요청자 → `pr_review_requested`, `CHANGES_REQUESTED` 리뷰 → `pr_changes_requested`, PR 작성자가 아닌 사람의 코멘트 → `review_commented`, 작성자의 답 → `review_replied`. `dedupe_key` 는 GitHub 의 리뷰·코멘트 id. 본문은 저장하지 않는다(GitHub 가 원본).
2. `flow_step_skip` 명령 하나(MCP tool 과 `sangsoe graph skip`): 이유가 비면 거부, 있으면 `flow_step_skipped{step, reason}`.

**파일**: `core/detect/pr/round.ts`, `core/detect/pr/judge.ts`, 새 `core/detect/pr/reviews.ts`, `core/graph/edit.ts`, `claude-plugin/mcp/tools/` 의 새 파일 하나(서버가 폴더를 자동으로 읽는다), 새 `cli/commands/` 파일 하나(라우터 `cli/main.ts` 는 그 폴더를 읽으므로 고치지 않는다), `test/detect/pr*`.

**시험**: 녹화한 GitHub 응답으로 넷이 한 번씩 써지고 두 번째 라운드는 아무것도 쓰지 않음, ETag 304 에서 쓰지 않음; 이유 없는 건너뜀 거부.

**층**: 토큰 X(pr-monitor 는 plugin worker 타이머, 명령은 코어). 호스트 기능: GitHub REST via `gh`, 리뷰를 사람에게 알리는 것은 GitHub 자신.

## 6. U3b — Orca escalation 소비, 세션 event, prompt 출처 (L, 결정 196)

**항목**: #9 #12 #13 #14 #15 #17. 의존: U1.

**설계의 약속과 main**:
- #9: `worker_dead` 의 사유 `stop_failure` 는 쓰는 곳이 없다(`core/contract/events/worker_dead.ts:3`). orca-monitor 는 liveness 가 죽음일 때만 `worker_dead` 를 쓰고(`core/detect/orca/judge.ts:90` 근처) 조용함은 `worker_stuck{no_activity}` 로 늦게 잡는다(`core/detect/orca/judge.ts:110`). 메시지의 type·subject 는 읽지 않는다. Orca 가 보내는 "오류로 멈춤" · "프롬프트 대기" escalation 은 이 저장소에서 아직 한 번도 관찰되지 않았다: 그 메시지의 모양(필드 `stopReason` 이 있는지)은 **추정**이다.
- #12: `worker_idle` 의 원천은 Stop hook 이었고 짓지 않았다(`docs/design-appendix.html:214`).
- #13: `observed_change` 는 P10 이 실패할 때만 쓰는 대체 경로다(`docs/glossary.md:266`). P10 은 부분 통과였다: `lastOutputAt` 은 출력을 따라가고, 터미널이 둘 붙은 세션은 두 값이 그대로였다(`docs/test-outcomes.md:29`). 그 경우가 대체 경로가 필요한 자리다.
- #14: `refusal_report` 의 원천은 `PermissionDenied` hook 이었다(`core/contract/events/refusal_report.ts`). auto-mode 의 거부는 프롬프트를 띄우지 않으므로 Orca 의 "프롬프트 대기" escalation 이 덮지 못한다. 거부된 세션은 이미 규칙대로 escalation 을 보내며, 본문에 명령을 적은 파일 경로를 담는다.
- #15: 실제 `worker_done` 은 Orca 메시지이고 행으로는 쓰지 않는다(결정 186).
- #17: 결정 173(`docs/decisions.md:466`)이 `agent.prompt.before` 를 스모크 측정 뒤로 미뤘다. 설계 리뷰 B1 이 세 미지수를 적었다(`docs/research/design-review-2026-11-10.md:365`). manifest 는 hook 을 선언하지 않는다(`orca-plugin/orca-plugin.json`).

**하는 일**(1단계가 먼저다):
1. **녹화**: 사용 한도로 멈춘 워커와 로그인 만료로 멈춘 워커 각각의 Orca escalation, `worker_done` 메시지, 거부 보고 escalation 을 `inbox --json` 으로 하나씩 녹화해 fixture 로 둔다. 필드 이름이 정해지기 전에는 판정을 쓰지 않는다.
2. **orca-monitor 가 inbox 를 판정한다**(이미 읽는 같은 응답, 새 Orca 호출 없음): 오류로 멈춤 → `worker_dead{stop_failure}`(dispatch 당 한 번); 프롬프트 대기 → `waiting_human`. 원천은 하나로 가른다: Dispatch 를 쥔 세션은 Orca 메시지만, Dispatch 없는 세션은 Notification hook 만 쓴다(hook 은 Dispatch 가 있으면 쓰지 않는다). 이렇게 하면 plugin 이 꺼져 hook 이 돌지 않는 워커도 잡힌다. `waiting_human` 은 지금 `session` 만 받으므로(`core/contract/events/waiting_human.ts:4`) 선택 칸 `dispatch` 를 더하고, 그 행이 로컬 hook 에서 온다고 보는 읽는 쪽(`core/detect/queue/round.ts:93`, `core/owner/todo.ts:45`)을 함께 고친다. `worker_done` 메시지 → `worker_done{dispatch, task, msg_id}` 표지(본문은 옮기지 않는다). 계약의 `outcome` 은 Orca 가 원본인 사실이라 결정 196 이 계약에서 뺀다(읽는 쪽은 Orca 에서 읽는다). 거부 보고 → 본문이 가리키는 거부 파일의 머리 줄(행위·분류)을 읽어 `refusal_report{act, category, command_file}`. 거부 파일의 머리 줄 형식은 결정 196 이 고정한다.
3. **escalation 이 리드와 brief 에 닿는다**: Orca 는 그 escalation 을 이미 코디네이터(리드)에게 보낸다. sangsoe 는 다시 보내지 않고 위 행으로 brief 의 🚨 줄에 올린다(표시는 U6b).
4. **`worker_idle`**: 이미 등록한 Stop hook 이 턴 끝에서, 그 세션이 끝나지 않은 Dispatch 를 쥐고 `worker_done` 을 보내지 않았으면 쓴다(턴마다 dedupe). 새 hook 등록 없음.
5. **`observed_change`**: 한 Dispatch 에 터미널이 둘 이상이라 `worktree ps` 시각을 못 믿는 행에만, 상태·단계·liveness 중 바뀐 필드 이름을 쓴다(값은 쓰지 않는다).
6. **prompt 출처(#17)**: B1 의 첫 미지수(오케스트레이션 메시지 배달이 `agent.prompt.before` 를 지나는가)를 실제 Orca 에서 먼저 잰다. 지나면 manifest 에 관찰만 하는 hook 을 선언하고 worker 가 (터미널, prompt 해시) 한 줄을 쓰며, 채팅 hook 은 그 줄과 맞는 prompt 를 오너의 말로 보지 않는다. 지나지 않으면 결정 196 에 그 측정을 적고 결정 173 의 꼴 규칙을 그대로 둔다. manifest 를 바꾸면 오너가 plugin 을 다시 승인해야 한다(오너의 일).

**파일**: `core/detect/orca/judge.ts`, `core/detect/orca/round.ts`, 새 `core/detect/orca/mail.ts`, `core/contract/orca.ts`(`InboxMessage` 에 subject·body 외 필드, `core/contract/orca.ts:160`), `core/orca/adapter.ts`(inbox 응답 읽기), `core/contract/events/{waiting_human,worker_done}.ts`, `core/detect/queue/round.ts`, `core/owner/todo.ts`, `core/session/record.ts`(Stop 의 idle, Notification 의 Dispatch 확인, 출처 대조), `orca-plugin/orca-plugin.json`, `orca-plugin/main.ts`, `test/detect/orca*`, fixture.

**시험**: 녹화한 두 멈춤(사용 한도·로그인 만료)이 각각 `worker_dead{stop_failure}` 하나가 되고 다음 라운드에 다시 쓰지 않음; `worker_done`·거부 보고 메시지가 각 행 하나; Dispatch 를 쥔 세션의 턴 끝이 `worker_idle`; 출처 줄이 있는 prompt 는 오너의 말로 기록되지 않음.

**층**: 토큰 X(orca-monitor·hook·plugin worker). 호스트 기능: Orca `inbox`·escalation·`agent.prompt.before`, Claude Code Stop hook.

**겹침**: `core/contract/orca.ts`·`core/orca/adapter.ts` 를 U1 과 나누므로 U1 이 머지된 뒤에 시작한다. `record.ts` 는 U3b 만. U6b 가 그릴 사유 이름(이 단위와 U2 의 새 사유)은 이 단위의 계약 파일이 정한다.

## 7. U4 — 시작과 계보: cwd 없는 오케스트레이터, 저장소 건너기, P2 의 계보 결함 (L, 결정 197)

**항목**: #24 #26 #35(시작 쪽) #42 #43 #44. 의존: U1(`repo`·`keep-open` flag).

**설계의 약속과 main**:
- #24: `start_unit` 은 요청자가 밝힌 worktree 가 cwd 를 품은 가장 안쪽 worktree 가 아니면 거부한다(`core/start/start.ts:225`–`230`). 이것은 사칭을 막는 검사다. 그 앞에서 Run 소유는 이미 Orca 가 호출한 세션 기준으로 답한다(`run-current`, `core/start/start.ts:209`). Orca 는 cwd 를 품은 worktree 가 없으면 `worktree current` 에 "No Orca-managed worktree contains the current directory" 로 답한다(훑기에서 `/tmp` 로 확인).
- #26: `start_unit` 은 언제나 `--worktree new-child` 로 시작하고 `--repo` 를 넘기지 않는다(`core/start/start.ts:325`). 그래서 자식은 부모의 저장소에 생긴다.
- #42–#44(P2 실측, 오케스트레이터가 전한 것): 시작된 Task 에 `decision_open` 을 하면 Orca 가 `task_not_startable` 로 거부한다; 결정의 subject 는 `item:iNNN` 이어야 하는데(`core/decision/key.ts:11`) `start_unit` 이 spec 으로 만든 Task 에는 그 별칭이 없다; 자기 Run 을 쥔 리드의 `handoff_save` 가 `dispatch_run_mismatch` 로, Dispatch 없는 세션의 escalation 이 `sender_not_assignee` 로 거부된다(`core/session/handoff.ts:43` 는 `run:<id>` 로 보낸다). 셋 다 sangsoe 가 Orca 를 부르는 모양의 결함이다.

**하는 일**:
1. **1단계 재현**: 위 셋을 가짜 Orca 가 아니라 실제 Orca 에서 한 번씩 재현해 응답을 fixture 로 둔다.
2. `start_unit` 에 대상 저장소 입력(`repo`: Orca 저장소 선택자)을 더하고 `item_create`·`sangsoe item new` 도 같은 칸을 받아 `item_extra_set` 으로 남긴다. 계보는 Run 과 Task 의 `parent` 로 지킨다.
3. **먼저 잴 것**: 다른 저장소를 `--repo` 로 준 `new-child` 를 Orca 가 받는지 잰다. 받으면 그것을 쓰고, 받지 않으면 `new-top-level --repo <대상>` 에 `--run`·Task `parent` 로 계보를 잇는다. 이 단위의 브리프가 그 placement 를 허락해야 한다.
4. 일반 폴더나 Orca 폴더 문맥의 오케스트레이터: cwd 검사는 요청자가 worktree 를 밝혔을 때만 둔다. 밝히지 않은 오케스트레이터는 `run-current` 가 Run 소유를 증명하면 시작할 수 있고, 자식은 2–3 의 대상 저장소로 간다. 리드·워커의 요청은 지금처럼 worktree 와 cwd 를 맞춘다(사칭 방지는 그대로). Orca 가 터미널 핸들로 호출자의 worktree 를 직접 답하는 방법이 있는지는 이 단위가 확인한다(이 계획 작업에서는 그 확인이 거부되었다, §12).
5. 리드를 시작할 때 `--keep-open` 을 넘긴다. 해제는 U1 이 적은 오케스트레이터다.
6. `start_unit` 이 만든 Task 도 `item_created` 의 별칭을 받아 `item:iNNN` subject 가 된다. 시작된 Task 의 결정은 Orca gate 가 아니라 sangsoe 의 `decision_opened` 행과 Orca 메시지로 연다(gate 는 시작 전 Task 에만). `handoff_save` 와 Dispatch 없는 escalation 은 Orca 가 받는 수신자 꼴로 보낸다(재현 응답이 정한다).

**파일**: `core/start/start.ts`, `core/start/types.ts`, `core/start/item.ts`, `core/decision/open.ts`, `core/session/handoff.ts`, `claude-plugin/mcp/tools/`(start_unit·item_create 스키마, 서버가 폴더를 자동으로 읽으므로 등록 파일은 없다), `cli/` 의 item 명령, `test/start/*`, `test/decision/*`, `test/session/*`.

**시험**: cwd 가 `/` 일 때와 모든 저장소 밖 폴더일 때 각각 `start_unit`(오케스트레이터는 통과, 리드·워커는 거부); 대상 저장소를 준 시작이 그 저장소에 worktree 를 만들고 Run·parent 가 이어짐; 재현한 세 응답이 각각 고친 경로에서 거부되지 않음.

**층**: 토큰 X(코어). 토큰 O 는 오케스트레이터 글에 `repo` 를 쓰는 법 한 줄. 호스트 기능: Orca `worker-start --repo --keep-open`, `run-current`, Orca 메시지.

**겹침**: `core/start/start.ts` 를 U5 와 나눈다(U5 가 뒤). CLI 명령은 `cli/commands/` 의 새 파일이라 U3a 와 겹치지 않는다.

## 8. U6a — 묶음 상세 화면 (L, 결정 199)

**항목**: #21 #22 #37. 의존: U6b(같은 `core/brief/build.ts`·`orca-plugin/panel/` 파일을 만지므로 뒤에 돈다).

**묶음 상세 화면(결정 92, `docs/decisions.md:307`, `docs/design.html:284`)**: 데이터는 `buildGroup`(`core/brief/build.ts:261`), 그림은 `group()`(`orca-plugin/panel/view.ts:213`).

| group.html 부분 | 상태 | 자리 |
|---|---|---|
| 의존 그래프 인라인 SVG(239–302) | 지음. 노드 제목·간선 라벨이 시안보다 적다 | `orca-plugin/panel/view.ts:163` |
| 간선 종류 범례(288–300) | 지음 | `view.ts` 의 범례 표 |
| 크리티컬 패스(306–319) | 지음(두 칸) | `core/brief/build.ts` 의 `criticalPath` |
| 스택 PR 체인(321–332) | 없음 | — |
| 릴리스 묶음(334–346, 흐름 틀의 머지 → deploy 단계표) | 없음 | — |
| 끊긴 선행 표(348–358) | 표 없음. 묶음 밖 선행은 붉은 점선으로만 | `core/brief/build.ts:284` |
| 왜 준비되지 않았나(362–373) | 지음(다섯 칸) | `group()` |
| 간선 표(376–392) | 없음 | — |
| 열린 항목 절(395–411): 막힘·진행 중·대기열, 누가 기다리나 | 지음. 기간 칸·PR 고리는 없음 | `core/brief/build.ts:270` |
| 완료 최근 7일(414–420) | 접힌 건수만 | `group()` 의 꼬리 |
| 요약 수치(우선순위·7일 완료·진행·막힘·남음) | 없음 | — |

결정 92 이후 이 부분을 자른 결정은 없다(결정 169·170 은 머리 배치와 상태 표시줄만 바꿨다, `docs/dashboard/hallmark-final/README.md:3`). 그래서 빠진 것은 모두 NOW 다. 최근 전환은 시안의 묶음 화면에 없고 항목 화면에 있다.

**오너가 닿는 길**: 현황의 진행 중 절에서 묶음 행을 누르거나 Enter → `panel.brief` 에 묶음 이름 → `buildGroup`(`core/brief/panel.ts:64`). 없는 묶음은 `not_found`(`core/brief/panel.ts:66`). **0 묶음**: 머리 줄이 "묶음 0"(`orca-plugin/panel/view.ts:140`)이고 빈 절은 "없음"이다. 묶음이 어떻게 생기는지(리드를 띄우면 생긴다) 알려 주는 안내 줄 하나를 더한다.

**U51 대조 결과(#37)**: U51 이 fixture 로 실제 패널과 상태 표시줄을 그려 본 결과다(오케스트레이터가 전함). 위 표와 겹치는 줄은 이쪽을 따른다.

| 찾은 것 | 분류 | 크기 | 단위 |
|---|---|---|---|
| 머리와 항목 이력 시각이 UTC(`orca-plugin/panel/view.ts:72`, `core/brief/build.ts:345`) | NOW(#28) | S | U6b |
| `selector_not_found` 원문 JSON(`orca-plugin/panel/requests.ts:54`–`55`, `orca-plugin/panel/index.ts:50`) | NOW(#23·#27) | S | U6b |
| 0 묶음 · `not_found` · `core_unavailable` 이 머리와 뒤로 없이 화면 전체를 붉은 줄로 바꾸고 새로 고침이 되풀이됨(`orca-plugin/panel/index.ts:38`–`41`) | NOW | S | U6b |
| 처리한 ⏳ 검증 대기 행에서 완료 버튼이 계속 눌림(`orca-plugin/panel/index.ts:65`–`70`, `view.ts:131`) | NOW | S | U6b |
| 리드 행이 묶음 화면을 연다는 표시가 없음(`view.ts:134`, `style.ts`) | NOW | S | U6a |
| 완료 최근 7일 접힌 절 없음(모델에 `doneDays` 만, `view.ts:146`) | NOW | M | U6a |
| 묶음 상세 요약 수치 없음(`view.ts:224`) | NOW | M | U6a |
| 묶음별 최근 전환 없음(`GroupDetail`, `view.ts:23`–`35`) | NOW | M | U6a |
| 의존 그래프: id 만 있는 노드, 상태 이모지·간선 라벨 없음, 한 층 배치와 교차, 날 선행 id 노드, PR id 넘침, 끊긴 화살촉 공유(`view.ts:163`–`211`) | NOW | L | U6a |
| 크리티컬 패스에 상태·단계 이름 없음(`view.ts:215`, `:226`) | NOW | S | U6a |
| 간선 범례가 네 종류뿐, 접힌 모양에서 종류와 뜻이 붙음(`style.ts:154`–`173`, `view.ts:216`–`218`) | NOW | S | U6a |
| 스택 PR 체인 · 릴리스 묶음(단계 사실은 `core/graph/facts.ts` 에 있고 `GroupDetail` 에 없음) · 끊긴 선행 · 간선 목록 | NOW(#21) | M·M·M·S | U6a |
| 왜 준비되지 않았나의 id 칸 잘못 씀(`view.ts:227`), `graph.why` 가 `after`·`stacked_on` 행을 보이지 않음(U51 관찰. `core/graph/read.ts:44` 의 거르기는 trigger·hold·orca 행만 버리므로 원인 자리는 U6a 가 찾는다) | NOW | M | U6a |
| 추천대로 답이 이유 없이 꺼짐(`view.ts:124`) · 상태 절 배치(`view.ts:225`) · 완료 N건 각주(`view.ts:228`) · 검증 대기의 영어 문구 · 항목 상세 접힘 라벨 잡음과 남은 점(`view.ts:236`) | LATER(다음 패널 단위) | S | — |
| U51 의 그림 하네스를 시각 회귀 fixture 로 남기기 | LATER(다음 패널 단위) | M | — |
| 행마다 확인함(결정 91 이 시안을 대체) · 상태 표시줄 시안 글(결정 170 이 대체) | DROP | — | — |
| 패널 위 빈 띠는 호스트 쪽 | 보류 그대로 | — | — |

U6a 는 이 표로 3–5시간을 넘는다. 한 자리에 끝나지 않으면 의존 그래프 배치(L)를 떼어 U6a 뒤에 따로 돈다.

**파일**: `orca-plugin/panel/view.ts`, `orca-plugin/panel/style.ts`, `orca-plugin/panel/index.ts`(0 묶음 안내의 이동), `core/brief/{build,types}.ts`, `core/graph/read.ts`(`graph.why`), `test/brief/*`, `test/panel/*`.

**시험**: 묶음 fixture 하나로 빠진 부분마다 한 줄씩(스택 체인 층, 릴리스 단계, 끊긴 선행 행, 간선 행, 7일 완료 목록, 요약 수치); 0 묶음에서 안내 줄.

**층**: 토큰 X. 호스트 기능: Orca plugin 패널, 흐름 틀(릴리스 묶음), `gh` 의 PR base(스택 체인, `pr_base_changed` 행 재사용).

**겹침**: 보류 목록의 상태 표시줄 글 꼴(`core/brief/panel.ts:56` 의 글)과 패널 위 빈 띠(머리 배치)는 만지지 않는다.

## 9. U6b — 패널 읽기·cwd·시각·doctor·event 표시 (L, 결정 198)

**항목**: #16 #23 #25 #27 #28 #29 #40 #41 #45. 의존: U1. U2·U3a·U3b 의 새 행과 사유 이름은 그 단위들의 계약 파일을 따르고, 그 전에는 fixture 로 그린다.

**패널 읽기(#40, P2 실측)**: 상태 표시줄과 `sangsoe todo` 는 결정 1 인데 패널 띠는 결정 0 이고, 그 위에 `selector_not_found` 상자와 멈춘 갱신 시각이 보였다. 패널의 읽기가 상태 표시줄과 같은 원본(`core/brief/panel.ts` 의 같은 계산)과 같은 갱신을 쓰게 한다. `selector_not_found` 는 아래 #23 의 `--worktree active` 다.

**cwd(#23 #25)**: 패널의 열기 요청이 `orca terminal create --worktree active` 를 부른다(`orca-plugin/panel/requests.ts:54`). plugin worker 의 cwd 는 `/` 이고, 실패는 stderr 앞 200자를 붉은 상자로 보인다(`orca-plugin/panel/requests.ts:55`). 고침: 화면 행이 가진 worktree id 를 `id:<id>` 로 넘기고, 행이 없으면 Orca 를 부르지 않고 거부한다. `claude-plugin/mcp/recorder.ts:13` 은 `-C` 없는 `git rev-parse` 로 기록자를 정하고 일반 폴더에서는 영어로 거부한다: 세션 worktree 로 `git -C` 를 부르고 없으면 짧은 한국어로 거부한다. `core/gates/facts.ts:46` 은 빈 cwd 를 "모름, 통과"로 명시한다. `core/session/locate.ts:52` 는 cwd 가 비면 아무것도 하지 않는다(그대로). `brief`·`land`·`item_create` 는 cwd 를 읽지 않는다.

**패널 오류(#27)**: 지금은 `${code}: ${reason}` 이고(`orca-plugin/panel/index.ts:39`) 코드와 고칠 말은 영어다. 코드별 한국어 한 줄 표를 두고 원문은 `title` 에만 둔다.

**시각(#28)**: 사람이 보는 시각은 모두 ISO 문자열을 잘라 UTC 로 그린다: 패널 머리(`orca-plugin/panel/view.ts:72`), `sangsoe brief` 머리(`core/brief/render.ts:32`), 항목 이력(`core/brief/build.ts:345`). 상태 표시줄 tooltip 에는 시각이 없다(`core/brief/panel.ts:56`). 하는 일: 코어에 시각 형식 함수 하나(시스템 시간대, `Intl.DateTimeFormat`)를 두고, 패널은 코어가 만든 글을 받는다(패널은 코어를 import 하지 않는다). 저장은 UTC 그대로. 시험: 고정한 UTC 순간을 `TZ` 가 UTC 가 아닌 환경에서 그린다.

**doctor(#29)**: 행은 이미 있다: `claude-plugin-version` 이 `enabled === false` 면 경고하고(`core/checks/claude-plugin-version.ts:24`), `orca claude profile` 이 Orca 의 프로필을 본다(`core/install/doctor.ts:95`). 그런데 P2 는 꺼진 plugin 에서 초록을 보았다. 의심되는 자리 둘: `enabled` 가 없으면 켜진 것으로 지나간다(같은 파일 :5, :24); `warn` 은 종료 코드를 바꾸지 않는다(`core/install/doctor.ts:31`). 하는 일: 꺼진 프로필에서 `claude plugin list --json` 출력을 녹화해 재현하고, 원인대로 고친다(꺼짐을 `fail` 로, 빈 `enabled` 를 모름으로). 시험은 그 녹화 fixture. P2 에서 설정을 다시 쓴 뒤 sangsoe 의 `enabledPlugins` 항목이 사라진 일도 같은 행이 잡아야 한다(보류된 `sangsoe isolate status` 는 만들지 않고, 같은 사실을 doctor 행으로만 본다).

**land 허락 행(#41, P2 실측)**: 워커에서 auto mode 가 `sangsoe land` 를 거부해 머지 다리가 사람 없이 돌지 못했다. 허락 규칙을 더하는 것은 오너의 일이다. doctor 에 그 허락이 있는지 읽기만 하는 행을 더한다(설정은 쓰지 않는다).

**취소 표시(#45, P2 실측)**: `task-list --full` 에서 취소한 Task 는 `failed` 에 결과 `cancelled` 로 보인다. 항목 상태 읽기가 이것을 🗑️ 취소로 읽게 한다.

**event 표시(#16)**: 아홉 event 와 U2·U3b 의 새 사유를 항목 이력(`core/store/views/item_timeline.ts`)과 brief 의 🚨·대기 줄에 넣는다.

**파일**: `orca-plugin/panel/{index,requests,view}.ts`, `core/brief/{build,render,panel}.ts`, 새 `core/brief/time.ts`, `core/store/views/item_timeline.ts`, `core/graph/read.ts`(취소 읽기), `claude-plugin/mcp/recorder.ts`, `core/gates/facts.ts`, `core/checks/claude-plugin-version.ts`, 새 `core/checks/land-allowed.ts`, `core/install/doctor.ts`, `test/brief/*`, `test/panel/*`.

**시험**: cwd 가 `/` 일 때와 저장소 밖 폴더일 때 패널 열기(Orca 를 `active` 로 부르지 않음)와 recorder(한국어 거부); 패널 띠와 상태 표시줄이 같은 store 에서 같은 수; 패널 오류가 한 줄 한국어; 고정 UTC 순간을 비 UTC `TZ` 로; 꺼진 plugin fixture 가 초록이 아님; 취소 Task 가 🗑️.

**층**: 토큰 X. 호스트 기능: Orca plugin 패널·상태 표시줄, `claude plugin list`.

**겹침**: `orca-plugin/panel/index.ts`·`core/brief/build.ts` 는 U6b → U6a → U5 순서로만 만진다. 보류 목록의 상태 표시줄 글 꼴과 패널 위 빈 띠는 만지지 않는다.

## 10. U5 — 모델 정책 행, advisor 전달·상한·비용, 카탈로그 보기 (L, 결정 200)

**항목**: #30 #31 #32 #33 #39. 의존: U4(`core/start/start.ts`), U6a(`core/brief/`·`orca-plugin/panel/index.ts`).

**main**: 정책 표는 `core/models/table.ts` 이고 행마다 `effort` 와 오르는 사다리(effort 먼저, 그다음 tier)를 이미 가진다. 결정 187 ⑥(`docs/decisions.md:488`)은 `worker-start` 에 advisor 인자가 없어 오너 설정 `advisorModel` 의 키가 있을 때만 advisor 를 기대하고, worktree 설정 파일에 쓰는 것은 대안 ②로 버렸다.

**전달 가능성(#30)**, 공개 문서 기준(2026-11-11 읽음):
- advisor 를 고르는 길은 셋이다: `/advisor`, 설정 키 `advisorModel`, `--advisor` 실행 flag. 세션 하나에만 쓰는 것은 flag 뿐이다. 환경 변수는 끄는 `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` 만 있다(code.claude.com/docs/en/advisor).
- `advisorModel` 은 어느 설정 파일에서나 읽히고, 우선순위는 managed > 명령줄 > 프로젝트 local > 공유 프로젝트 > 사용자다(code.claude.com/docs/en/settings). 그래서 프로젝트 local 파일에 쓰면 사용자 설정 없이 행마다 줄 수 있다는 읽기가 있다.
- 같은 페이지는 프로젝트 local 설정에 대해 "In a worktree, it uses the file at the main checkout's root." 라고 적는다. 이 문장대로면 새 worktree 안의 `.claude/settings.local.json` 은 읽히지 않고, 메인 체크아웃의 파일에 쓰면 그 저장소의 모든 세션에 닿는다.
- Orca: `worker-start` 는 worktree 를 만들고 agent 를 한 번에 띄운다. `orca worktree create` 로 먼저 만들고 `worker-start --worktree <기존>` 으로 띄우면 파일을 쓸 틈이 있다. agent 에 임의 인자·환경 변수를 넘기는 flag 는 없다.
- 결론: 틈은 있지만 그 파일이 읽히는지가 갈린다. **1단계는 실제 워커 하나로 재는 것이다**: 새 worktree 의 local 설정에 `advisorModel` 을 쓰고, 그 세션이 advisor 를 쓰는지 transcript 로 본다(프로젝트 파일의 신뢰 확인이 이 키를 막는지도 같이 본다). 읽히면 결정 200 이 결정 187 의 대안 ②를 명시적으로 대체하고 `start_unit` 이 행의 advisor 를 그 파일에 쓴다(worktree 를 먼저 만들고 띄우는 두 단계). 읽히지 않으면 결정 187 의 오너 설정 경로를 그대로 두고, 메인 체크아웃 파일에는 쓰지 않는다. 어느 쪽이든 Orca 가 `worker-start` 에 advisor 를 내면 이미 있는 `orcaTakesAdvisor` 경로를 쓴다.
- Fable advisor 의 일회 usage-credits 동의는 계정 상태라 읽을 수 없다: 오너에게 한 번 묻는다.

**정책 행(#31·#32)**: 일의 종류 여덟에 tier · effort · advisor · advisor 호출 예산 · 오르는 trigger 를 둔다. tier·effort 값의 원본은 `core/models/table.ts` 하나이므로(사본을 막는 시험 `test/model-table.test.ts:84`) 아래는 지금 행에서 무엇을 바꿀지만 적은 제안이다. 결정 200 이 기록하고 근거 문장은 표의 `cite` 에 둔다.

| 종류 | 지금 행 | 바꿀 것 | advisor 예산 | 오르는 trigger | 이유(출처) |
|---|---|---|---|---|---|
| mechanical | `sweep` | effort 한 단계 내림 | 0 | 실패하면 지금처럼 다음 tier 로 다시 | model-config 의 가장 낮은 단계: "a small change like a rename" |
| docs | 없음(새 행) | 구현 행의 tier, advisor 없음 | 0 | Act-on 두 번 → effort 한 단계 | model-config: "day-to-day engineering work with a clear scope" |
| implementation | `worker`(class default) | effort 한 단계 내림 | 3 | 첫 Act-on → effort 되돌림, 둘째 → 지금의 다음 tier | advisor tool 페이지: 낮은 tier 본 모델을 중간 effort 로 두고 높은 advisor 를 붙이면 "comparable ... at lower cost" |
| hard implementation | class `hard` | effort 한 단계 올림 | 3 | effort 한 단계 더 → 다음 tier | model-config: "verification matters or edge cases are likely" |
| root-cause · design | class `design` | 그대로 | 3 | 다음 tier | 결정 187 |
| review | `review` | 그대로, advisor 없음 | 0 | 판정 다툼 → 다음 tier | 결정 187 |
| final stable review | `release-review` | 그대로, 내리지 않음 | 0 | 큰 릴리스 → effort 한 단계 | effort 페이지: 가장 높은 tier 는 기본 단계에서 시작하고 그 위는 측정한 이득이 있을 때 |
| 묶음 진행 세션 | 그 역할의 지금 행 | 그대로 | 하루 6 | 위험 → effort 한 단계 | 결정 187 |

effort 가 high 아래에서 시작하는 행의 브리프에는 "일 전체를 끝까지 하라" 한 줄을 넣는다. advisor 의 effort 는 설정할 수 없으므로 그 칸은 두지 않는다. `start_unit` 은 항목의 kind·class 로 행을 고르고, 고른 행과 이유를 시작 event 에 남기며, brief 가 단위마다 보인다.

**상한과 비용(#33)**: Claude Code 에는 advisor 호출을 제한하거나 강제하는 설정이 없고("There is no setting to cap or force advisor calls"), API 의 `max_uses` 는 한 턴 안의 상한이다. 그래서 상한은 (1) 브리프의 글(접근을 정하기 전, 끝내기 전, 막혔을 때, 약 2–3회), (2) sangsoe 가 transcript 의 advisor 호출을 세어 brief·doctor 에 단위별·일별 호출 수와 추정 비용을 보이는 것, (3) 상한을 넘은 세션은 다음 시작 때만 advisor 를 끄는 것이다. 끄는 길은 실행 환경의 `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` 이고 이 키로는 다시 켤 수 없다. **먼저 잴 것**: 이것을 worktree local 설정의 `env` 로 줄 수 있는지(위 1단계 측정과 같은 문제). 진행 중인 세션을 그 자리에서 끄는 길은 없다: 결정 200 에 그대로 적는다.

**모델 카탈로그 보기(#39)**: 원본은 `core/models/table.ts` 하나이고 셋 모두 거기서 그린다(사본 없음). (1) 토큰 X CLI 보기 `sangsoe models`: 카탈로그 행(tier · alias · 지금 모델 id · 가격 · 기본 effort · 출처 URL · 확인한 날)과 일의 종류별 정책 행(위 표의 칸과 이유), 지금 걸린 고정, 확인한 날이 오래되면 알림. 화면 글은 한국어. (2) 패널의 더 보기 메뉴가 `brief` 처럼 그 CLI 보기를 터미널로 연다(U6b 가 고친 열기 경로를 쓴다). (3) `docs/models.md` 는 `table.ts` 에서 만들고, 둘이 어긋나면 실패하는 시험을 둔다(사본을 막는 시험 `test/model-table.test.ts:84` 는 그 생성 파일을 예외로 두어야 한다). 독립 검토는 (3) 을 빼고 (1) 만 두자고 제안했다(파생 사본): 오너가 청한 것이므로 남기고 이 한 줄로 알린다.

**파일**: `core/models/table.ts`, 새 `core/models/view.ts`, `cli/` 의 models 명령, `docs/models.md`(생성), `orca-plugin/panel/index.ts`(메뉴 한 줄), `core/start/start.ts`(행 선택·기록·설정 파일), 새 `core/models/spend.ts`(transcript 의 advisor 호출 세기, `core/session/transcript.ts` 재사용), `core/checks/model-table.ts`, `core/brief/render.ts`·`core/brief/build.ts`(비용 줄 한 줄), `claude-plugin/agents/{lead,worker}.md`, `claude-plugin/skills/write-brief/`(토큰 O 글).

**시험**: 여덟 행의 짝 검사; kind·class → 행 선택과 시작 event 기록; 녹화한 transcript 로 호출 수와 비용 계산; 설정 파일 경로는 1단계 결과에 따라 쓰기 또는 안 쓰기.

**층**: 정책 표·선택·세기는 토큰 X, 예산 글은 토큰 O. 호스트 기능: Claude Code advisor·`--effort`·설정 우선순위, Orca `worker-start --effort`.

## 11. 오너가 자를지 정할 것

- (2026-11-11 오너가 잘랐다, 결정 203) **결정 125 "주석만" 파서: DROP 제안.** 언어마다 tokenizer 가 있어야 하고 설치된 것은 개발 의존인 `typescript` 뿐이라, 의존이 없는 배포 패키지에 첫 실행 의존이 생긴다. 얻는 것은 주석만 바꾼 PR 이 V2 대신 V0 이 되는 것(시험 한 번 덜 돌림)뿐이다. 다시 볼 때: 주석만 바뀐 PR 이 자주 V2 증거를 기다릴 때.
- (2026-11-11 오너가 잘랐다, 결정 203) **결정 88 다른 PC: 단위 없음 제안.** 비로컬 행 거르기는 지었고 시험이 있다(`core/orca/host-filter.ts:6`). 남은 것은 relay 를 켠 둘째 PC 에서의 P11(`docs/test-outcomes.md:30`)이고, 오너가 그 PC 를 붙일 때 돌린다.
- (2026-11-11 오너가 잘랐다, 결정 203) **B2 ask/reply 를 코어 어댑터로: DROP 제안.** 메시지의 원본은 Orca 이므로 sqlite 에 옮기면 이중 저장이고, 중복은 Orca 의 `--retry-request` 가 막는다. 답 없는 질문은 orca-monitor 가 이미 Orca 에서 읽는다. 어댑터의 `ask`·`reply` 행은 U1 이 지운다.
- (2026-11-11 오너가 잘랐다, 결정 203) **P2 의 `gh repo clone` 실패: DROP 제안.** sangsoe 코드는 `gh repo clone` 을 부르지 않는다(core·cli·claude-plugin 을 찾아 봄). 세션이 직접 부른 명령이라 sangsoe 의 고칠 거리가 아니다. 다시 볼 때: sangsoe 가 저장소를 받아 오는 명령을 가질 때.

보류 목록(`sangsoe isolate on|status|off`, 상태 표시줄 글 꼴, 패널 위 빈 띠)은 계획하지 않았고, U6a·U6b 는 그 자리를 만지지 않는다.

## 12. 이 계획 작업의 한계

- Orca 의 멈춤 escalation 은 관찰하지 못했다: 모양은 추정이고 U3b 1단계가 녹화한다. 녹화가 되지 않으면(Orca 가 그 메시지를 보내지 않으면) U3b 는 그 판정을 쓰지 않고 결정 196 에 적는다.
- 호출자 worktree 를 Orca 가 터미널로 답하는지 보려던 읽기 하나가 hook 에 막혔고 다시 돌리지 않았다. U4 4단계가 확인한다.
- 세 훑기(cwd·어댑터, 묶음 화면·시각·doctor, 공개 문서)는 서브에이전트가 했고, 인용한 줄은 이 문서를 쓰기 전에 다시 열어 맞췄다.
