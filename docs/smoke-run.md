# smoke 종단 실행 기록 (U23)

설계 §6 의 "종단 실행 한 번"이다. 오케스트레이터 → 리드 → 워커 → land → 닫기를 버리는 저장소 하나로 돌리고, 단위들이 가짜 Orca 로만 잰 길을 실제 Orca 에서 잰다. 항목마다 판정은 `PASS` · `FAIL` · `NOT VERIFIED`(이유) 셋 중 하나이고, 판정 줄은 `판정: <값>` 꼴이다(`test/e2e/smoke/smoke-run.test.ts` 가 센다). 인용한 출력의 홈 경로는 `~` 로 줄였다.

## 환경

- 설치본: `sangsoe 0.1.0-rc.4`. `sangsoe doctor` 14행 `ok`(`orca plugin: local.sangsoe 0.1.0-rc.4, running`, `orca-plugin-content: … = 빌드 커밋 72fb3fed8ef7 = 리뷰된 head e69267f54083`) + `notice reaper-config`(REAPER 는 표시만). 이 doctor 는 이 카드의 Claude 프로필만 보았고, Orca 가 세션을 여는 프로필에서는 sangsoe 가 `disabled` 였다(오너가 켬)
- 버리는 저장소: `JeongJaeSoon/sangsoe-smoke`
- 격리 설정(`claude --settings <scratch>/smoke-settings.json`):

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "" },
  "enabledPlugins": { "sangsoe@sangsoe": true, "agent-skills@jeongjaesoon": false, "agent-skills@inline": false }
}
```

이 Mac 의 agent-skills 는 `enabledPlugins` 가 아니라 사용자 설정의 `env.CLAUDE_CODE_PLUGIN_DIRS` 로 실린다(`claude plugin list` 에 `agent-skills@inline`). 그래서 격리는 그 env 를 비워야 한다. headless 세션의 init 기록으로 잰 값:

| 설정 | init 의 plugin 목록에 agent-skills | `agent-skills:` skill 수 | `sangsoe:` skill 수 |
|---|---|---|---|
| 없음(프로젝트 `.claude/settings.json` 에 같은 json) | 있음 | 31 | 14 |
| `claude --settings <위 json>` | 없음 | 0 | 14 |

`orca orchestration worker-start` 에는 agent 인자·env·실행 명령을 넘길 칸이 없다("How the worker runs follows the user's own setting for new agent tabs; there is no flag for it"). 그래서 `start_unit` 이 여는 리드·워커는 `--settings` 를 받지 못한다. 오너가 smoke 동안 사용자 설정의 그 변수를 비우면 코드 변경 없이 리드·워커도 격리된다.

세션마다 격리 확인(코드 없음): 세션 transcript 는 skill 목록을 attachment 로 남긴다. `grep -c "agent-skills:" <transcript>` 가 0 이고 `grep -c "sangsoe:" <transcript>` 가 1 이상이면 그 세션은 격리됐다. transcript 경로는 `orca orchestration worker-show --dispatch <id> --json` 의 세션 id 와 작업 폴더로 찾는다.

## 준비 순서

1. 버리는 저장소를 scratch 에 clone 하고 `orca repo add` 로 Orca 에 올린다. Orca CLI 에 저장소를 내리는 명령이 없어 등록은 남고, 보고에 적는다.
2. 그 저장소의 Orca worktree 하나에 터미널을 열고 `claude --settings <scratch>/smoke-settings.json --agent sangsoe:orchestrator` 를 띄운다. 이 터미널의 handle 과 PID 를 적는다.
3. 오케스트레이터는 `orca orchestration run-create` 로 자기 Run 을 쥐고 `item_create` → `start_unit`(리드)을 부른다. 그 아래는 위 실행 계획대로다.

## 리허설 1회차 (2026-11-10, 설치본 rc.4)

리드의 결정으로 이 회차는 리허설이다. 리드·워커 격리가 깨져 있었고(아래 표), land 의 결함 하나가 머지 구간을 막았다. P2 본 실행은 안정 릴리스에서 처음부터 다시 돈다.

세션과 격리(각 세션 자신의 transcript 가 남긴 skill 목록의 서로 다른 항목 수):

| 세션 | worktree | Dispatch · Run | `agent-skills:` | `sangsoe:` | 격리 |
|---|---|---|---|---|---|
| 오케스트레이터(`--settings`, 터미널 PID 기록) | smoke-orch(부모 u23) | 없음 · run_a3197f0091d7 | 0 | 27 | PASS |
| 리드 | tuskfish(부모 smoke-orch) | ctx_abb4d99b3a9f(깊이 1) · 자기 Run run_0e6251774b13 | 35 | 26 | FAIL |
| 워커 | seanettle(부모 tuskfish) | ctx_496443fce0c2(깊이 2) · run_0e6251774b13 | 35 | 26 | FAIL |

리드·워커 FAIL 의 원인: 활성 Orca 프로필의 사용자 `settings.json` 11번째 줄 `CLAUDE_CODE_PLUGIN_DIRS` 가 다시 agent-skills 경로를 담고 있었다(파일 수정 시각 17:45 JST, sangsoe 를 그 프로필에 켠 단계 무렵. 08:39Z 에는 비어 있었다). `start_unit` 은 Orca 의 `worker-start` 로 세션을 열고, `worker-start` 에는 세션별 설정을 넘길 칸이 없다.

## 1. 리드의 Run 과 start_unit 으로 워커 시작 (unit_lineage_complete)

오케스트레이터(`--agent sangsoe:orchestrator`)의 첫 Bash 호출은 세 명령을 이어 붙였고, sangsoe 의 `[gate:delegate]` 가 통째로 거부했다. 원인은 `orca worktree current` 가 그 게이트의 허용 목록(`orca worktree list|show|ps`)에 없는 것이다. 단독 `run-create` 는 통과했다:

```
{"ok":true,"result":{"runId":"run_a3197f0091d7","objective":"sangsoe smoke"}}
item_create → {"task":"task_30061319d847","alias":"i001"}
start_unit(orchestrator → lead) → {"kind":"started","taskId":"task_30061319d847","dispatchId":"ctx_abb4d99b3a9f","worktreeId":"…::~/orca/workspaces/smoke-repo/tuskfish","notes":[]}
```

리드는 자기 Run(run_0e6251774b13)을 만들고 `start_unit`(lead → worker)으로 워커를 열었다(Task task_6efa8eca787e, Dispatch ctx_496443fce0c2, worktree seanettle). 되읽기:

```
dispatch-show --task task_30061319d847 → id ctx_abb4d99b3a9f, run run_a3197f0091d7, depth 1, creator = 오케스트레이터 터미널
dispatch-show --task task_6efa8eca787e → id ctx_496443fce0c2, run run_0e6251774b13, depth 2, creator = 리드 터미널
worktree list: seanettle <- tuskfish, tuskfish <- smoke-orch, smoke-orch <- u23
SANGSOE_REAL_RUN=run_a3197f0091d7 SANGSOE_REAL_PARENT=<smoke-orch> node --test --test-name-pattern unit_lineage_complete test/lineage/real-orca.test.ts
units 1 · complete 1 · removed after completion 0 · broken 0
✔ unit_lineage_complete on real Orca
```

같은 시험을 리드의 Run 에 돌리면 `no started units on this Run`: 워커 Task 가 `failed`(land 실패로 worker_done failed)라 시험의 `dispatched`·`completed` 거름에 걸린다. 워커의 Dispatch·Run·`parentWorktreeId` 는 위 되읽기로 모두 있다.

리드의 첫 프롬프트 역할 줄은 `sangsoe-role: worker` 였다(`item_create` 의 `who: lead` 와 `start_unit` 의 `childRole: lead` 인데도). 리드 worktree 의 브랜치 이름도 `sangsoe-worker-role-task` 다.

판정: PASS (lineage 세 칸 되읽음, 실제 Orca 의 unit_lineage_complete 녹색. 역할 줄 어긋남은 finding)

## 2. raw_start_refused (`orca agent launch` 시도)

리드 세션이 한 번 시도했다(`orca agent launch --agent claude --worktree current --json`). 세션은 열리지 않았다:

```
[gate:start] Refused: a fallback start through Orca's agent-launch command opens a session outside the core start path (decision 94). Agents: call the MCP tool start_unit (mcp__plugin_sangsoe_sangsoe__start_unit), the one core start path. People: create the item with sangsoe item new and the orchestrator starts it. Do not reach the same start another way (a script, another session, another tool).
```

판정: PASS

## 3. 실제 PR 에 sangsoe land, pr-monitor 실제 라운드

설치본(rc.4)의 land 는 smoke PR(`JeongJaeSoon/sangsoe-smoke#1`, private)을 읽지 못했다:

```
pr_unreadable — …: 404 Not Found
```

land 가 저장소 이름을 소문자로 바꾼 뒤 그 이름으로 GitHub 를 불렀고, fine-grained 토큰은 private 저장소를 다른 대소문자로 부르면 404 를 준다. 별도 PR(`JeongJaeSoon/sangsoe#45`, merge 5e0200d4, main CI 녹색)로 고쳤다. pr-monitor 도 저장된 소문자 이름으로 GitHub 를 읽어 같은 404 가 난다(리드가 U36 으로 넘김).

머지 구간은 고친 소스(847db05)로 돌렸다. 설치본이 아닌 리허설이다. `~/.config/sangsoe/config.json` 은 원래 없었고, `{"verdict_merge_repos":["JeongJaeSoon/sangsoe-smoke"]}` 한 줄만 넣었다. 리드(작성자 아님)가 head 02056f2f 에 verdict 를 기록했고, 저장소는 `jeongjaesoon/sangsoe-smoke` 로 소문자 저장됐다. land 가 묻는 subject 도 소문자라 서로 맞았다.

```
node cli/main.ts land --repo JeongJaeSoon/sangsoe-smoke --pr 1 --dry-run --json
{"code":"evidence_missing","reason":"evidence_missing:test — V3 (config unreadable) needs test, run, dev at 02056f2; test: no row; run: no row; dev: no row", …}
```

`readLandConfig` 는 같은 파일에서 등급 설정도 읽는다. `verify_tier` 목록이 모두 있어야 `parseTierConfig` 가 값을 돌려주므로, `verdict_merge_repos` 만 든 파일은 등급 설정이 null 이 되어 V3 으로 닫힌다(파일이 없을 때와 같다).

리드의 결정으로 머지 구간은 여기서 멈췄다. 증거를 기록할 입구가 아직 없고(U36 이 만든다), 다른 길로 행을 쓰거나 돌리지 않은 test·run·dev 를 적으면 이 구간을 꾸미게 된다. smoke PR 은 열린 채 남았다. `config.json` 은 원래대로 없앴다(휴지통).

판정: NOT VERIFIED (land 까지 갔으나 `evidence_missing` V3 로 거부됨: 증거 기록 입구 없음 + `verdict_merge_repos` 만 든 설정에서 등급 설정 null. pr-monitor 실제 라운드는 같은 소문자 404 때문에 돌리지 않음)

## 4. 실제 Orca 의 알림 (U29)

판정: NOT VERIFIED (리허설이 머지 구간에서 멈춰 알림을 따로 재지 않음. P2 본 실행 몫)

## 5. 실제 transcript 의 hook (U27 · U13)

판정: NOT VERIFIED (smoke 세션에서 `!` 줄 · handoff_save · review_ask_record 를 부르지 않음. P2 본 실행 몫)

## 6. queue 라운드 non-dry (U17)

판정: NOT VERIFIED (리허설에서 돌리지 않음. P2 본 실행 몫)

## 7. 패널 · 상태 표시줄 · `sangsoe todo` 숫자, 추천대로 답 (U28)

세 곳의 숫자를 같은 시각(14:05Z 무렵)에 읽었다:

```
상태 표시줄: 🚧0 · 결정0 · 🔄0
sangsoe todo: 내가 할 일 0 (결정 0 + 할 일 0)
패널 brief: 내가 할 일 0 · 🔄 진행 중 0 · 갱신 11/10 08:53
sangsoe brief: 현황 · 2026-11-10 14:05Z · 묶음 0 · 내가 할 일 0 … 🔄 진행 중 0건
```

세 숫자는 0 = 0 = 0 으로 맞지만, 열린 결정이 없어 "추천대로 답" 은 누를 대상이 없었다. 또 smoke 항목(i001, run_a3197f0091d7 에서 dispatched)이 있는데도 `brief` 의 진행 중이 0 이고, 패널의 갱신 시각이 08:53 에 멈춰 있었다(finding).

판정: NOT VERIFIED (숫자 일치는 0 끼리라 의미가 약하고, 열린 결정이 없어 추천대로 답을 누르지 못함. 진행 중 0 · 멈춘 갱신 시각은 finding)

## 8. MCP resource 서버 이름, Run 없는 패널 버튼 보내기

이 카드 세션에서 `ListMcpResourcesTool` 의 서버 이름은 `plugin:sangsoe:sangsoe` 였고, 그 이름으로 `ReadMcpResourceTool` 이 읽혔다:

```
ListMcpResourcesTool(server: plugin:sangsoe:sangsoe) → sangsoe://brief, sangsoe://ready
ReadMcpResourceTool(plugin:sangsoe:sangsoe, sangsoe://ready) → "준비된 항목 없음"
```

판정: NOT VERIFIED (서버 이름은 PASS. Run 없는 패널 버튼 보내기는 눌러 보지 않음)

## 9. 쓰는 migrate import (scratch 사본만)

실제 sangsoe 저장소와 옛 agent-skills 저장소를 `sqlite3 <db> ".backup <scratch>"` 로 scratch 에 떴다(`.backup` 은 `-wal` 의 내용까지 한 파일로 합친다. 원본에는 `sangsoe.db-wal` 4.1 MB · `-shm` 이 있었다). `HOME=<scratch home>` 으로 돌려 기본 저장소 경로가 사본을 가리키게 했다.

```
HOME=<scratch>/home sangsoe migrate --from <scratch>/old/agent-skills.db --dry-run --json
dry-run {'items': {'open': 23, 'create': 23, 'already': 0, 'todo': 9, 'doing': 1, 'held': 13}, 'decisions': {'open': 0, 'create': 0, 'already': 0}, 'edges': {'create': 0, 'already': 0}, 'skipped': {'closedItems': 120, 'closedDecisions': 76, 'boardRows': 14, 'leads': 1}}
```

U21 이 이 Mac 에서 잰 수(열린 항목 23 · todo 9 · doing 1 · held 13 · 닫힌 120/76 · 리드·카드 행 14 · 리드 1)와 같다. 이미 있는 저장소 위의 dry run 은 `already 0` 으로 끝났고 사본은 바뀌지 않았다.

U21 의 경계 경우: WAL `-shm`/`-wal` 파일 — 위처럼 `.backup` 사본에서는 문제없음(살아 있는 WAL 을 그대로 복사하는 경우는 재지 않음). `after_ref` 순환 · links 키 덮어쓰기 · `order_` 행 — 이 Mac 의 옛 저장소에는 열린 간선이 0 이라 재지 못함(가짜 저장소 시험 `test/migrate/migrate.test.ts` 몫). `--apply` 는 Orca Run 에 Task 23개를 실제로 만든다: 저장소는 사본이어도 Orca 쓰기는 진짜라 리허설에서는 돌리지 않았다.

판정: NOT VERIFIED (쓰는 import 는 Orca 에 Task 23개를 만드는 실제 쓰기라 리허설에서 돌리지 않음. dry run 과 WAL 사본은 PASS)

## 전환 조건 집계 (`docs/switch-conditions.md` 46행, 리허설 시점 main)

증거 칸이 찬 행 26 · 빈 행 20. 찬 26 중 M1 은 스스로 "미달"(19/23 · 8/23)이고 M3 는 smoke 종단(이 기록)을 기다린다. 그래서 충족 24 · 미충족 22.

| 미충족 행 | 주인 | 이 smoke 가 더한 것 |
|---|---|---|
| B1 · B4 · C8 | U0·U5 · U5(+U12) · U5 | 없음 |
| B2 · C13 | U2 | 없음 |
| C3 · C4 | U7(+U11·U16) · U7 | 없음 |
| C5 · C6 | U8·U14(+…) · U8 | C6 의 `term_` 주소 거부는 실제 Orca 에서 한 번 봄(`[gate:report-address]`) |
| C7 | U9 | 없음 |
| C9 | U10 | `unit_lineage_complete` 실제 Orca 녹색(항목 1). T5 는 미실행 |
| C10 | U12 | `raw_start_refused` 실제 거부 1(항목 2). `[gate:delegate]` 가 `orca worktree current` 를 막는 오탐 1 |
| C11 | U13 | 리드의 역할 줄이 `worker` 로 적힘(항목 1) |
| C12 | U14 | 없음 |
| D1 · D2 · D3 | U15(+U10) | 없음 |
| I1 · I2 · I3 | U4·U24 | 활성 Orca 프로필에서 sangsoe 가 꺼져 있는데 doctor 가 녹색(환경) |
| M1 | U21 | 없음 |
| M3 | U21·U23 | 리허설 종단(아래 10) · 쓰는 가져오기는 미실행(항목 9) |

## 10. 닫기: worker_done → release → 카드 닫힘, REAPER 표시

워커는 land 실패 뒤 `worker_done` failed 를 보냈고, 리드는 닫으라는 프롬프트를 받아 `sangsoe:end-session` 뒤 `worker_done` failed 를 한 번 보냈다(msg_d41eaed56eda). 오케스트레이터는 그 보고를 받았고 완료를 판정하지 않았다. 리드가 쓴 종료 근거("U23 lead's decision")가 자기 체인 밖에서 왔다고 짚었다. 실제로 이 프롬프트는 U23 카드가 리드 터미널에 직접 보냈다.

```
worker-release --dispatch ctx_496443fce0c2 → state released, closed_agent_terminal, transcript captured
worker-release --dispatch ctx_abb4d99b3a9f → state released, closed_agent_terminal, transcript captured
terminal close (오케스트레이터 · 빈 셸) → ptyKilled true ×2
worktree rm --run-hooks --delete-branch: seanettle · tuskfish · smoke-orch → removed true ×3(지우기 전 셋 다 미커밋 0, 워커 커밋 02056f2 는 원격에 있음)
```

REAPER 표시 라운드(`sangsoe reap run --dry-run --mark-only`, worktree 를 지우기 전):

```
"roots_ok": false, "unseen": ["protect list: no reaper section in ~/.config/sangsoe/config.json", "open PRs of jeongjaesoon/sangsoe-smoke"], "cards": 22
```

REAPER 도 smoke 저장소의 열린 PR 을 소문자 이름으로 읽다 못 읽었다(같은 대소문자 결함). 루트를 못 읽어 정리 0 으로 닫힌 것은 설계대로다.

판정: PASS (worker_done → release → worktree 제거까지 실제 Orca 에서 이어짐. REAPER 는 roots_ok=false 로 정리 0, 소문자 PR 읽기는 finding)
