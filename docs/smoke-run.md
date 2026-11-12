# smoke 종단 실행 기록 (U23)

설계 §6 의 "종단 실행 한 번"이다. 오케스트레이터 → 리드 → 워커 → land → 닫기를 버리는 저장소 하나로 돌리고, 단위들이 가짜 Orca 로만 잰 길을 실제 Orca 에서 잰다. 항목마다 판정은 `PASS` · `FAIL` · `NOT VERIFIED`(이유) 셋 중 하나이고, 판정 줄은 `판정: <값>` 꼴이다(`test/e2e/smoke/smoke-run.test.ts` 가 센다). 인용한 출력의 홈 경로는 `~` 로 줄였다.

## 환경 (P2 본 실행, 2026-11-11 JST)

- 설치본: `sangsoe 0.1.0`(brew 안정 릴리스). `sangsoe doctor` 은 `ok` 17행과 `notice` 4행이었다(`orca-plugin-content: … = 빌드 커밋 9f827e9b9d44 = 리뷰된 head ce79e90f25ab`, notice 는 reaper-config · tier-config · watch-repos · model-table). 시작 전에 Orca 가 세션을 여는 프로필에서 Claude 쪽 `sangsoe@sangsoe` 가 `disabled` 였는데 doctor 는 녹색이었다. 첫 오케스트레이터가 `--agent 'sangsoe:orchestrator' not found` 로 떴고, 오너가 user scope 로 켰다
- 격리: 오너가 활성 프로필의 `CLAUDE_CODE_PLUGIN_DIRS` 를 비웠다(05:40:16 JST). 세션을 하나 띄우기 직전마다 읽기 전용 점검으로 값과 파일 시각을 적었다: `''`(05:40:16) → `''`(05:45:36, sangsoe 의 enabledPlugins 항목이 사라진 쓰기) → `''`(06:24:54, 오너의 enable). 오케스트레이터는 `--settings` 없이 프로필 그대로 띄웠다
- 임시 설정: `~/.config/sangsoe/config.json` 은 없던 파일이다. README 의 `verify_tier` 다섯 목록 + `verdict_merge_repos: ["JeongJaeSoon/sangsoe-smoke"]` 로 만들었다(doctor `tier-config: 검증 등급 설정 읽음`). 기계 전체에 걸리는 설정이라 끝에 휴지통으로 옮긴다. pr-monitor 의 `watch.repos` 는 이 파일이 아니라 scratch home 의 설정으로 줬다(`sangsoe monitor run pr --home <scratch> --db <실제 저장소>`)
- 세션마다 격리 판정: 그 세션 transcript 의 skill 목록에서 서로 다른 `- agent-skills:<이름>` 항목 수가 0 이고 `- sangsoe:<이름>` 이 1 이상, 그리고 `claude plugin list` 의 `sangsoe@sangsoe` 가 enabled. CLAUDE.md 본문에도 "agent-skills:" 글자가 있어 단순 `grep -c` 는 쓰지 않는다

## 환경 (리허설 1회차, 2026-11-10)

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

transcript 경로는 프로필의 `projects/<작업 폴더 slug>/<세션 id>.jsonl` 이다.

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

## P2 세션과 격리

| 세션 | worktree(부모) | Dispatch · Run | `agent-skills:` | `sangsoe:` | `sangsoe@sangsoe` | 역할 줄 | 격리 |
|---|---|---|---|---|---|---|---|
| 오케스트레이터(`claude --agent sangsoe:orchestrator`, 터미널 term_08521b12…) | p2-orch(u23) | 없음 · run_ba31feb8f9bc | 0 | 27 | enabled | — | PASS |
| 리드 | emperor(p2-orch) | ctx_08db458f8b2d · 자기 Run run_7d1b870451e3 | 0 | 26 | enabled | `sangsoe-role: lead` | PASS |
| 워커 | basketstar(emperor) | ctx_50d97ec8bc47 · run_7d1b870451e3 | 0 | 26 | enabled | `sangsoe-role: worker` | PASS |

## 1. 리드의 Run 과 start_unit 으로 워커 시작 (unit_lineage_complete)

P2: 오케스트레이터가 `run-create`(run_ba31feb8f9bc) → `item_create`(task_fa401bcde518, i002) → `start_unit`(childRole lead) 를 불렀고, 리드는 자기 Run(run_7d1b870451e3)에서 `start_unit`(childRole worker)으로 워커를 열었다(task_1f7ca673d92e). 리드의 역할 줄과 브랜치 이름(`sangsoe-lead-role`)이 이제 lead 다(리허설의 finding 고쳐짐). `item_create` 의 역할 기본값은 worker 라서 오케스트레이터가 `role: "lead"` 를 직접 넣어야 했다.

```
start_unit(orchestrator → lead) → {"kind":"started","taskId":"task_fa401bcde518","dispatchId":"ctx_08db458f8b2d","worktreeId":"…::~/orca/workspaces/smoke-repo/emperor","launch":{…}}
start_unit(lead → worker) → {"kind":"started","taskId":"task_1f7ca673d92e","dispatchId":"ctx_50d97ec8bc47"}(worktree basketstar)
(launch 의 모델 · effort 는 각 역할의 행 그대로: 돌린 판인 v0.1.0 의 core/models/table.ts)
SANGSOE_REAL_RUN=run_ba31feb8f9bc SANGSOE_REAL_PARENT=<p2-orch> … → units 1 · complete 1 · removed after completion 0 · broken 0 ✔
SANGSOE_REAL_RUN=run_7d1b870451e3 SANGSOE_REAL_PARENT=<emperor> … → units 1 · complete 1 · removed after completion 0 · broken 0 ✔
```

첫 Bash(지시 파일을 `cat`)는 `[gate:delegate]` 에 막혔다(gate_denied seq 41636). 오케스트레이터는 Read 로 읽었다.

판정: PASS (두 Run 모두 실제 Orca 의 unit_lineage_complete 녹색, 세 세션 격리)

### 리허설(rc.4)

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

리허설 판정(rc.4): PASS (역할 줄 어긋남은 finding)

## 2. raw_start_refused (`orca agent launch` 시도)

P2: 리드가 `orca agent launch --agent claude --worktree current --json` 을 한 번 시도했고 같은 `[gate:start]` 문구로 거부됐다(gate_denied seq 41640). 세션은 열리지 않았다.

판정: PASS

리허설에서도 리드 세션이 한 번 시도했다(`orca agent launch --agent claude --worktree current --json`). 세션은 열리지 않았다:

```
[gate:start] Refused: a fallback start through Orca's agent-launch command opens a session outside the core start path (decision 94). Agents: call the MCP tool start_unit (mcp__plugin_sangsoe_sangsoe__start_unit), the one core start path. People: create the item with sangsoe item new and the orchestrator starts it. Do not reach the same start another way (a script, another session, another tool).
```

## 3. 실제 PR 에 sangsoe land, pr-monitor 실제 라운드

P2: 워커가 `test/smoke.test.mjs` 하나를 더한 `JeongJaeSoon/sangsoe-smoke#2`(head aab80096)를 열었다. `verify-tier` 는 V1 · 증거 `["test"]`. 리드(작성자 아님)가 scratch clone 에서 그 head 를 받아 `node --test test/` 를 직접 돌리고(1 pass, exit 0) 새 입구로 기록했다. `gh repo clone` 은 private 저장소에서 GraphQL "Could not resolve" 로 실패해 리드가 `git clone` 을 썼다.

```
evidence (seq 41937): {"kind":"test","head_sha":"aab80096…","exit_code":0,"not_verified":["CI on GitHub (not checked)","other Node versions …","run/ui/dev kinds …"]}
review_verdict (seq 41938): {"pr":"jeongjaesoon/sangsoe-smoke#2","head_sha":"aab80096…","act_on":0,"reviewer":"smoke-lead","author":"jeongjaesoon"}
```

워커가 `sangsoe land --repo JeongJaeSoon/sangsoe-smoke --pr 2 --json` 을 한 번 부르자 Claude Code auto mode 분류기가 막았다("1 action blocked by auto mode · Auto mode: No reason provided"). 다시 부르지 않았고 MCP land 도구로 돌아가지도 않았다. 리드의 결정으로 머지 구간은 오너가 워커 터미널에서 `! sangsoe land …` 를 칠 때까지 멈춘다.

pr-monitor 실제 라운드(private 저장소, scratch home 의 `watch.repos`):

```
sangsoe monitor run pr --home <scratch> --db ~/.local/share/sangsoe/sangsoe.db
written [('pr_opened', 41951), ('verify_tier_set', 41952)]  unseen []  calls []  aborted False
```

리허설의 소문자 404 는 사라졌다(`unseen []`). scratch 설정에 `verify_tier` 가 없던 첫 dry run 은 `verify_tier_set` 을 V3("config unreadable")로 쓰려 했다. pr-monitor 와 land 가 같은 PR 의 등급을 서로 다른 설정에서 읽을 수 있다.

머지(오너가 워커 터미널에서 `!` 줄을 친 뒤, 11-11 03:27Z):

```
land_requested (seq 60860): {"pr":"jeongjaesoon/sangsoe-smoke#2","head_sha":"aab80096…","reason":"verdict_approved"}
land 출력: "action":"merge_verdict","merge_method":"squash" — 점검 중 required_review_and_ci · up_to_date_or_queue · stale_approvals_dismissed 가 ok:false("unreadable: branch protection")
gh pr view 2 → MERGED, merge commit 49cee191, merged_at 03:27:16Z
sangsoe monitor run pr --home <scratch> → written pr_merged (seq 61149), acts: task-update task_1f7ca673d92e completed → ok, "already completed"
```

land 는 branch protection 을 읽지 못한 세 점검을 막지 않고 verdict 로 머지했다(smoke 저장소에는 보호 규칙이 없다). `task-update completed` 는 워커의 `worker_done` 이 먼저 Task 를 닫아 "already completed" 로 끝났다. T5(끝난 Task 를 리드가 다시 `start_unit`)는 리드 Task id 를 넘기지 않아 `lineage_invalid`("lead 의 Task id 가 없어 Dispatch 를 읽을 수 없다")로 먼저 거부됐고, `dispatched` 거르기까지 가지 않았다.

판정: PASS (머지 · `pr_merged` · `task-update` 길과 pr-monitor 의 private 저장소 실제 라운드. T5 는 이 실행에서 NOT VERIFIED: 리드 Task id 누락으로 앞 단계에서 거부. 아래 T5 재실행에서 PASS. 읽지 못한 branch protection 을 막지 않고 머지한 것은 finding: 보호 규칙이 있는 저장소에서는 열린 채 실패한다)

T5 재실행(2026-11-12, U93): 리드 세션이 stable 0.1.4 MCP 로 자기 Run 에서 돌렸다. 리드는 Dispatch 없는 Run 주인이라 `start_unit` 의 오케스트레이터 꼴(`role: orchestrator`, 자기 worktree, `taskId` 없음)로 불렀다. 버리는 항목은 둘이다: 한 번 시작된 Task 는 이후 `already_dispatched` 로 실패 세기 앞에서 멈추므로, 컷오프(B)와 이중 시작(A)을 한 Task 로 잴 수 없다.

```
B 1–3 start_unit {task: B, repo: "name:t5-no-such-repo"} → orca_error "worktree create 실패 (repo_not_found: repo_not_found)"
      저장소: signal{start_refused, orca_error, target worker-start} + escalation{to: owner} 한 쌍씩 ×3, 셋째 뒤 loop_detected{start_failed_3x}
B 4   같은 호출 → {"kind":"stopped","why":"start_failed_3x"}
B 5   repo 없이 → {"kind":"stopped","why":"start_failed_3x"}
A 1   start_unit {task: A} → {"kind":"started", dispatchId, worktreeId}
A 2   바로 같은 호출 → {"kind":"waiting","why":"already_dispatched"}
정리  A: worker-release · worktree rm → ok. B: task-update failed/cancelled → ok. item retire A·B → not_retirable(결정 223 ③)
```

첫 호출은 rc.3 에서 뜬 MCP 서버라 `server_stale` 로 거부됐고 세지 않았다(결정 211). 리드 세션을 다시 띄운 뒤 위 차례로 돌렸다. 판정: T5 PASS(이중 시작 거부 · 3회 컷오프 · Task 마다 세기).

### 리허설(rc.4)

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

리허설 판정(rc.4): NOT VERIFIED (`evidence_missing` V3: 증거 입구 없음 + 부분 설정에서 등급 null)

## 4. 실제 Orca 의 알림 (U29)

P2: 워커가 오너 입력을 기다리자(`waiting_human` seq 41930) sangsoe 가 그 Task 를 쥔 리드의 Run 으로 알림 하나를 실제로 보냈다:

```
notified (seq 41931, target task_1f7ca673d92e): {"msg_id":"msg_2c39e053db4c","to":"run:run_7d1b870451e3","msg_type":"escalation"}
```

Dispatch 없는 오케스트레이터의 escalation 은 Orca 가 거부했다(보낼 때 exit 1, 그리고 보낸 쪽 Run 에 [HIGH] 상태 메시지):

```
Rejected escalation: smoke: dispatch-less escalation test
Orca rejected this escalation: No active Dispatch belongs to this message sender.
payload: _orcaLifecycleRejection.code=sender_not_assignee
```

판정: PASS (알림이 실제로 전송됨: P2 에 seq 41931 · 41948 · 41954 세 통, Dispatch 없는 escalation 은 거부로 인용)

## 5. 실제 transcript 의 hook (U27 · U13)

P2:

- `review_ask_record`: 워커가 불렀다(`review_ask_sent` seq 41648). reviewer 로 리드의 터미널 handle 을 넘겨 `unmapped_reviewer` 도 함께 쓰였다(seq 41649).
- `handoff_save`: 리드가 두 번 불렀고 두 번 다 `send: dispatch_run_mismatch` 였다. 리드의 Dispatch 는 오케스트레이터의 Run(run_ba31feb8f9bc)에 있고 리드는 자기 Run(run_7d1b870451e3)을 쥐고 있다.
- 오너가 아닌 입력이 `owner_action{origin: chat}` 으로 쓰였다: 디스패치된 리드·워커 세션에 Orca 가 넣은 "You have 1 orchestration message. Run `orca orchestration check …`" 줄(seq 41926 · 41933 · 41939 · 41941)과 하네스가 보낸 줄. 워커의 `waiting_human` 은 `waiting_released{by: owner}`(seq 41943)로 닫혔는데, 실제로 답한 것은 리드의 메시지다.
- 오너의 `!` 줄: 워커 터미널에서 친 land 가 `owner_action{origin: shell}`(seq 61131, "sangsoe land --repo JeongJaeSoon/sangsoe-smoke --pr 2 --json")으로 쓰였다.
- Orca 재시작 뒤에도 같다: `orca terminal send` 로 넣은 줄(seq 60844 · 60854)과 Orca 가 쉬던 세션에 넣은 "You have 1 orchestration message …" 줄(seq 60855 · 61134)이 모두 `owner_action{origin: chat}` 이고, 그 뒤 `waiting_released{by: owner}`(ref 42231 · 41953 · 60849)가 따랐다.

판정: FAIL (`!` 줄 기록 · review_ask_record 는 PASS. handoff_save 는 dispatch_run_mismatch 로 FAIL, Orca 가 넣은 줄이 오너 입력으로 기록되고 오너 대기를 닫음은 finding)

## 6. queue 라운드 non-dry (U17)

P2: `--dry-run` 이 그래프 동기화 하나만 계획했고 Run 을 고르는 인자가 없어, 쓰기가 없음을 확인한 뒤 한 번 돌렸다:

```
sangsoe monitor run queue
{"monitor":"queue","planned":[],"written":[],"unseen":[],"calls":["graph sync: added 0, reland 0, dangling 0, refused 0","probeRound: read 0, passed 0, skipped 0"],"aborted":false,"acts":[]}
```

`item_ready` · `todo_due` 를 만들 항목이 없었다. 0.1.0 의 REAPER 타이머 라운드는 `roots_ok: true`, `mark_only: true` 로 10분마다 돌고(round 82–84), `timer_stalled{reaper, roots_ok=false}` 는 08:48Z 의 한 줄 뒤로 한동안 나오지 않다가 11-11 02:34:29Z(seq 58377, "roots_ok=false 3 rounds running")에 다시 나왔다. 원인은 토큰이 읽지 못하는 다른 소유자의 저장소다(아래 "P2 추가 확인").

판정: NOT VERIFIED (non-dry 라운드는 돌았으나 item_ready · todo_due 를 만들 상황이 없었다. 02:34:29Z 의 timer_stalled 는 REAPER 의 것(kind reaper, roots_ok=false)이고, queue 가 돌리는 일의 멈춤은 일어나지 않음)

## 7. 패널 · 상태 표시줄 · `sangsoe todo` 숫자, 추천대로 답 (U28)

P2(21:31Z, 같은 몇 초 안):

```
상태 표시줄 (plugin shot --status-bar): ✨ SANGSOE 🚧 0 · 결정 1 · 🔄 0
sangsoe todo: 내가 할 일 1 (결정 1 + 할 일 0) — d001 · 결정 — · 추천 —
패널 (plugin shot --panel brief, 폭 360): 붉은 띠 "selector_not_found … No Orca-managed worktree contains the current directory: /" · 현황 · 묶음 0 · 내가 할 일 0 (결정 0 + 할 일 0) · 갱신 11/10 20:47
sangsoe brief: 묶음 0 · 진행 중 0건 (i002 가 dispatched 인데도)
```

상태 표시줄과 `todo` 는 결정 1 로 맞고 패널은 0 이다. 패널은 새로 읽지 못하고(selector_not_found) 20:47Z 에 멈춰 있다. "추천대로 답" 을 누를 결정도 없었다: 리드의 `decision_open` 이 시작된 Task 에서 `gate-create … task_not_startable` 로 Orca 게이트 없이 d001 만 남겼고(질문·추천 칸 —), 둘째 시도는 `subject: expected item:iNNN or scope:<group>` 로 거부됐다(`start_unit` 이 spec 으로 만든 Task 에는 iNNN 별칭이 없다). 묶음이 0 이라 묶음 상세 화면도 열 수 없었다. 패널 캡처는 Orca 창이 보이는 중이라 `--theme light` 가 적용되지 않았다(themeApplied false).

판정: FAIL (실제 Orca 에서 패널 숫자 0 ≠ 상태 표시줄·todo 1, 패널 갱신 실패. 추천대로 답은 열린 게이트가 없어 누르지 못함)

### 리허설(rc.4)

세 곳의 숫자를 같은 시각(14:05Z 무렵)에 읽었다:

```
상태 표시줄: 🚧0 · 결정0 · 🔄0
sangsoe todo: 내가 할 일 0 (결정 0 + 할 일 0)
패널 brief: 내가 할 일 0 · 🔄 진행 중 0 · 갱신 11/10 08:53
sangsoe brief: 현황 · 2026-11-10 14:05Z · 묶음 0 · 내가 할 일 0 … 🔄 진행 중 0건
```

세 숫자는 0 = 0 = 0 으로 맞지만, 열린 결정이 없어 "추천대로 답" 은 누를 대상이 없었다. 또 smoke 항목(i001, run_a3197f0091d7 에서 dispatched)이 있는데도 `brief` 의 진행 중이 0 이고, 패널의 갱신 시각이 08:53 에 멈춰 있었다(finding).

리허설 판정(rc.4): NOT VERIFIED (0 끼리의 일치)

## 8. MCP resource 서버 이름, Run 없는 패널 버튼 보내기

P2: 서버 이름은 리허설과 같다(아래). Run 없는 패널 버튼 보내기는 재지 못했다: 패널이 html 이라 `plugin shot --act` 가 거부하고, 사람의 클릭 없이 버튼을 누를 길이 없다. 패널은 위 7 의 selector_not_found 띠를 보이고 있었다.

판정: NOT VERIFIED (서버 이름 `plugin:sangsoe:sangsoe` 는 PASS. Run 없는 버튼 보내기는 html 패널이라 자동으로 누를 수 없고 오너의 클릭이 필요)

리허설에서 이 카드 세션의 `ListMcpResourcesTool` 의 서버 이름은 `plugin:sangsoe:sangsoe` 였고, 그 이름으로 `ReadMcpResourceTool` 이 읽혔다:

```
ListMcpResourcesTool(server: plugin:sangsoe:sangsoe) → sangsoe://brief, sangsoe://ready
ReadMcpResourceTool(plugin:sangsoe:sangsoe, sangsoe://ready) → "준비된 항목 없음"
```

## 9. 쓰는 migrate import (scratch 사본만)

P2(0.1.0): 같은 scratch 사본으로 dry run 수가 그대로였다(열린 항목 23 · todo 9 · doing 1 · held 13 · 닫힌 120/76 · 리드·카드 행 14 · 리드 1). 리드의 결정으로 `--apply` 는 돌리지 않았다.

판정: NOT VERIFIED (쓰는 import 는 Orca 에 실제 Task 23개를 만들어 리드가 제외함. dry run 과 WAL `.backup` 사본은 PASS)

### 리허설(rc.4)

실제 sangsoe 저장소와 옛 agent-skills 저장소를 `sqlite3 <db> ".backup <scratch>"` 로 scratch 에 떴다(`.backup` 은 `-wal` 의 내용까지 한 파일로 합친다. 원본에는 `sangsoe.db-wal` 4.1 MB · `-shm` 이 있었다). `HOME=<scratch home>` 으로 돌려 기본 저장소 경로가 사본을 가리키게 했다.

```
HOME=<scratch>/home sangsoe migrate --from <scratch>/old/agent-skills.db --dry-run --json
dry-run {'items': {'open': 23, 'create': 23, 'already': 0, 'todo': 9, 'doing': 1, 'held': 13}, 'decisions': {'open': 0, 'create': 0, 'already': 0}, 'edges': {'create': 0, 'already': 0}, 'skipped': {'closedItems': 120, 'closedDecisions': 76, 'boardRows': 14, 'leads': 1}}
```

U21 이 이 Mac 에서 잰 수(열린 항목 23 · todo 9 · doing 1 · held 13 · 닫힌 120/76 · 리드·카드 행 14 · 리드 1)와 같다. 이미 있는 저장소 위의 dry run 은 `already 0` 으로 끝났고 사본은 바뀌지 않았다.

U21 의 경계 경우: WAL `-shm`/`-wal` 파일 — 위처럼 `.backup` 사본에서는 문제없음(살아 있는 WAL 을 그대로 복사하는 경우는 재지 않음). `after_ref` 순환 · links 키 덮어쓰기 · `order_` 행 — 이 Mac 의 옛 저장소에는 열린 간선이 0 이라 재지 못함(가짜 저장소 시험 `test/migrate/migrate.test.ts` 몫). `--apply` 는 Orca Run 에 Task 23개를 실제로 만든다: 저장소는 사본이어도 Orca 쓰기는 진짜라 리허설에서는 돌리지 않았다.

리허설 판정(rc.4): NOT VERIFIED (apply 건너뜀)

## P2 추가 확인 (오너 요청분)

격리는 11-11 03:31:58Z(12:31:58 JST)에 끝났다: 오너가 `CLAUDE_CODE_PLUGIN_DIRS` 를 되돌렸다. 아래 B1 · 재시작 · 교차 저장소 · cancelled 는 그 전에, REAPER 라운드와 항목 10 의 닫기는 그 뒤에 이미 떠 있던 세션으로 쟀다.

### Orca 재시작 (03:22:27Z, 앱 pid 8428 → 24511)

```
저장소: seq 1(2026-11-09T17:26:39Z)부터 남아 있고 재시작 뒤 첫 쓰기 03:23:30Z(seq 60844)
Claude 세션: 오케스트레이터 6c9c86a7 · 리드 4448b082 가 같은 id 로 재시작 뒤 프롬프트에 답함
터미널 handle: term_08521b12 · term_c6ce191d · term_9a39179c · term_d5b240e9 그대로
plugin: local.sangsoe "sangsoe worker started" 03:22:32Z · 03:22:33Z, running
REAPER 타이머: round 124(03:18:20Z) → round 125(03:32:38Z), 재시작 뒤 10분에 다시 돎
패널(plugin shot, 03:22 갱신): 할 일 4 에 w42231 이 남음. w42231 은 03:23:33Z 에 풀렸고 `sangsoe todo` 는 3
```

`timer_stalled{reaper, "roots_ok=false 3 rounds running"}` 가 02:34:29Z(seq 58377)에 다시 나왔다. 그 뒤 모든 라운드가 `roots_ok: false`. 표시 전용 dry run 의 `unseen` 은 토큰이 읽지 못하는 다른 소유자의 저장소 3개의 열린 PR 이다. smoke 저장소는 더 이상 `unseen` 에 없다.

판정: PASS (저장소 · 세션 · 터미널 · plugin · 타이머가 재시작을 넘김. 패널 갱신은 항목 7 의 FAIL 과 같음)

### `task-list --full` 의 cancelled 와 failed

Orca 에는 `cancelled` 상태가 없다(`invalid status 'cancelled', expected one of: pending, ready, dispatched, completed, failed, blocked`). 취소는 `--status failed --result cancelled` 다:

```
task_045a19b16212 "smoke cancel probe": status failed, result "cancelled"
```

판정: PASS (취소와 실패는 `status` 가 아니라 `result` 로만 갈린다)

### 교차 저장소 `start_unit`

sangsoe 저장소의 worktree(p2-xrepo)에 앉은 오케스트레이터가 smoke 저장소 일을 `item_create` → `start_unit` 으로 시작했다. 두 도구 모두 대상 저장소 칸이 없다.

```
부모 worktreeId: 44d00700-…::~/orca/workspaces/sangsoe/p2-xrepo
자식 worktreeId: 44d00700-…::~/orca/workspaces/sangsoe/sockeye (task_a249e0d9cb50, ctx_f79bec28bc5f)
자식 워커의 git remote get-url origin: https://github.com/JeongJaeSoon/sangsoe.git
```

자식은 부모의 저장소에 열린다. 다른 저장소의 일을 시작할 길이 없다. 정리: `worker-release` → released, `worktree rm --delete-branch` → removed(브랜치에 main 밖 커밋 0).

판정: PASS (탐침이 끝까지 돌았다. 결과는 finding: `start_unit` 에 대상 저장소 입력이 없다)

### `agent.prompt.before` 의 세 미지수 (B1)

탐침 plugin(관찰만, 늘 통과)을 오너가 승인해 띄우고 `orca plugin logs` 로 읽었다.

```
03:23:28.228Z agent.prompt.before term_08521b12… inputKind driving keys [agent, terminalId, prompt, inputKind] "U23 probe A (terminal send)…"
03:27:02.365Z agent.prompt.before term_c6ce191d… inputKind driving "U23 probe C…"
terminal.send: 0줄
```

1. orchestration 메시지는 이 hook 을 지나지 않는다. 쉬던 오케스트레이터가 메시지로 깨며 받은 "You have 1 orchestration message. Run `orca orchestration check --run run_ba31feb8f9bc`."(transcript 03:27:08Z, `promptSource: typed`, `origin: human`)에 두 hook 모두 줄이 없다. 일하던 세션에 온 메시지 두 통도 같다. 줄이 남은 것은 `orca terminal send` 뿐이다.
2. 터미널 id 는 이을 수 있다. 이벤트의 `terminalId` 는 `term_` handle 이고, 세션 안에서 `orca terminal show --json`(인자 없음, 0.15초)이 자기 handle 을 돌려준다.
3. hook 줄이 `UserPromptSubmit` 보다 먼저다. probe A: hook 03:23:28.228Z → transcript 03:23:29.793Z → `owner_action` 03:23:30.044Z. probe C: 03:27:02.365Z → 03:27:04.038Z.

판정: PASS (셋 다 잼. 1 이 "아니오" 라 B1 의 바꿈은 메시지 알림 줄을 가리지 못한다. 그 줄은 고정된 꼴이라 M2 의 꼴 규칙이 맡는다)

## 전환 조건 집계 (`docs/switch-conditions.md` 46행, P2 시점 main 4a77a43 이후)

46행 모두 증거 칸이 찼다. 그중 칸이 스스로 미달·연기라고 적은 행:

| 행 | 주인 | 칸의 상태 | 이 smoke 가 더한 것 |
|---|---|---|---|
| B1 | U0·U5 | 미달 1/3(job `timeout-minutes` 없음, flake 수 세는 단계 없음) | 없음 |
| B4 | U5(+U12) | 미달 2/3(공개 위생 검사가 저장소 안 시험이 아님) | 없음 |
| I1 | U4·U24 | 연기(실제 brew · Orca 승인) | 실제 brew 0.1.0 설치 · 승인 · doctor 녹색. 단 Claude 쪽 plugin 이 꺼진 프로필을 doctor 가 못 잡음 |
| I2 | U4 | 실제 `brew upgrade` 연기 | 없음 |
| I3 | U4·U24 | 연기(uninstall → 재설치) | 없음 |
| M1 | U21 | 미달(19/23 · 8/23) | 없음 |
| M3 | U21·U23 | 쓰는 가져오기와 smoke 종단은 전환 때 | 종단은 머지 · `pr_merged` 까지 돌았고 닫기는 손 release(항목 3 · 10), 쓰는 가져오기는 제외(항목 9) |

그래서 충족 39 · 미충족 7(B1 · B4 · M1 미달, I1 · I2 · I3 연기, M3 쓰는 가져오기 미실행). 실제 Orca 에서 이 smoke 가 칸의 주장과 어긋난 것을 본 행: PN3(패널 숫자 ≠ 상태 표시줄 · todo, 항목 7, 재시작 뒤에도), C11(Orca 가 넣은 줄이 `owner_action` 으로 기록되고 오너 대기를 닫음, 항목 5). D4 의 `task-update completed` 길은 실제 Orca 에서 돌았다("already completed", 항목 3).

### 리허설 시점 집계

증거 칸이 찬 행 26 · 빈 행 20. 찬 26 중 M1 은 스스로 "미달"(19/23 · 8/23)이고 M3 는 smoke 종단(이 기록)을 기다린다. 그래서 충족 24 · 미충족 22.

| 미충족 행 | 주인 | 이 smoke 가 더한 것 |
|---|---|---|
| B1 · B4 · C8 | U0·U5 · U5(+U12) · U5 | 없음 |
| B2 · C13 | U2 | 없음 |
| C3 · C4 | U7(+U11·U16) · U7 | 없음 |
| C5 · C6 | U8·U14(+…) · U8 | C6 의 `term_` 주소 거부는 실제 Orca 에서 한 번 봄(`[gate:report-address]`) |
| C7 | U9 | 없음 |
| C9 | U10 | `unit_lineage_complete` 실제 Orca 녹색(항목 1). T5 는 U93 이 리드 Run 에서 PASS(3절) |
| C10 | U12 | `raw_start_refused` 실제 거부 1(항목 2). `[gate:delegate]` 가 `orca worktree current` 를 막는 오탐 1 |
| C11 | U13 | 리드의 역할 줄이 `worker` 로 적힘(항목 1) |
| C12 | U14 | 없음 |
| D1 · D2 · D3 | U15(+U10) | 없음 |
| I1 · I2 · I3 | U4·U24 | 활성 Orca 프로필에서 sangsoe 가 꺼져 있는데 doctor 가 녹색(환경) |
| M1 | U21 | 없음 |
| M3 | U21·U23 | 리허설 종단(아래 10) · 쓰는 가져오기는 미실행(항목 9) |

## agent-skills → sangsoe 대응표 (P2 술어)

`docs/port-map.md` 의 행마다 한 줄이다. "P2 에서 씀" 은 이 smoke 의 세션이 그 대응물을 실제로 탔는지(근거는 위 항목 번호나 event seq)이다. DROP·GAP 은 port-map 의 이유를 줄여 적었다.

| agent-skills | sangsoe 대응물 | P2 에서 씀 |
|---|---|---|
| `skills/orchestrate` | `claude-plugin/skills/orchestrate` | 예: 오케스트레이터 · 리드(항목 1) |
| `skills/dispatch-card` | `claude-plugin/skills/start`, `core/start` | 예: `start_unit` 3회(항목 1 의 2회, 교차 저장소 탐침 1회) |
| `skills/end-session` | `claude-plugin/skills/end-session` | 아니오: P2 의 닫기는 손 release(항목 10). 리허설에서 리드가 씀 |
| `skills/deliver-ticket` | `claude-plugin/skills/deliver-ticket`, `core/land`, `core/verify` | 일부: PR · review_ask · 증거 · verdict 까지, 워커의 land 는 auto mode 가 막고 오너의 `!` 줄로 머지(항목 3) |
| `skills/reflect` | `claude-plugin/skills/reflect`, 시간선 뷰 | 아니오 |
| `skills/reap-resources` | `claude-plugin/skills/reap-resources`, REAPER | 예: 타이머 라운드 82–84(항목 6) |
| `skills/skills-config` | `claude-plugin/skills/setup`, `core/install` | 아니오(설정은 오너가 손으로) |
| `skills/setup-pc` | `claude-plugin/skills/setup`, `sangsoe install` · `doctor` | 예: doctor 17 ok(환경). Claude plugin 꺼짐을 못 잡음 |
| `skills/brief` | `claude-plugin/skills/brief` · `todo`, `core/brief` | 예: `sangsoe brief` · `todo`(항목 7) |
| `skills/watch-prs` | pr-monitor(`core/detect/pr`) | 예: 실제 라운드 seq 41951–41952(항목 3) |
| `skills/watch-mentions` | `orca-plugin/monitors/chat.ts`, `core/detect/chat` | 아니오 |
| `skills/reboot` | `core/recover`, SessionStart | 예: SessionStart 의 역할 기록 seq 41634 · 41638 · 41641. recover 는 아니오(Orca 재시작 뒤 세션 · 터미널이 그대로 남아 복구할 것이 없었다, "P2 추가 확인") |
| 일반 skill 14(architect … write-skill) | `claude-plugin/skills/general` | 아니오(smoke 일이 작아 부르지 않음. 세 세션의 skill 목록에는 있음) |
| `skills/use-notes` | DROP: 개인 노트 저장소(D-2, 결정 79) | — |
| `skills/use-tracker` | DROP: 외부 티켓은 Orca 참조만(결정 93) | — |
| `skills/write-ticket` | DROP: 결정 93, 후속 일은 `item_create` | — |
| `skills/secure-fill` | DROP: 개인 도구(결정 79, D-3) | — |
| `skills/tune-automode` | DROP: 개인 권한 설정(D-3) | — |
| `agents/orchestrator.md` | `claude-plugin/agents/orchestrator.md` | 예: `--agent sangsoe:orchestrator` 두 세션 |
| `agents/lead.md` | `claude-plugin/agents/lead.md`, `worker.md` | 예: 리드 · 워커(항목 1) |
| `agents/notes-writer.md` | DROP: D-2 | — |
| `agents/task-tracker.md` | DROP: 결정 93 | — |
| `hooks/hooks.json`, `dispatch.py` | `claude-plugin/hooks/hooks.json` 과 셸 진입 | 예: PreToolUse · SessionStart · UserPromptSubmit · Stop · Notification 이 event 를 씀 |
| `hooks/delegate_gate.py` | `core/gates/delegate.ts` | 예: gate_denied seq 41636 |
| `hooks/pressure_gate.py` | `core/gates/pressure.ts`, `core/capacity` | 아니오(무거운 명령 없음) |
| `hooks/self_land_gate.py`, `land_route_gate.py` | `core/gates/self-land.ts` | 아니오 |
| `hooks/guard.py` 와 시험 | `core/gates/start.ts` · `sleep-loop.ts` · `report-address`, GAP: 위험 명령 · 워커 규율 | 예: `[gate:start]` seq 41640. GAP 부분은 없음 |
| `hooks/lib` | `core/gates/shell.ts`, `core/session/shell.ts`, GAP: danger · discipline · coordination | 예: 게이트의 셸 파서 |
| `hooks/stack_gate.py` | GAP: 결정 119 가 미룸 | — |
| `hooks/claim_check.py` · `turn_check.py` · `owner_check.py` | GAP: 경고만 하는 턴 끝 점검, 어느 단위에도 없음 | — |
| `hooks/decision_relay.py` | GAP: 결정 기록 없는 중계 경고 | — |
| `hooks/decision.py` | `core/decision`, `sangsoe decision`, `core/session/record.ts` | 일부: `decision_open` d001 기록, Orca 게이트는 task_not_startable(항목 7) |
| `hooks/reorient.py`, `roles.py` | `core/session/session-start.ts`, `record.sh` | 예: 역할 · 모델이 `session_started` 에 남음 |
| `hooks/permission.py` | `core/session/record.ts`, 패널 | 예: `waiting_human` seq 41930 · 41947 |
| `hooks/subagent_log.py` · `lifecycle.py` · `record_check.py` · `onboard.py` | GAP: U13 이 넣지 않음 | — |
| `hooks/prose_check.py` | write-plainly 의 references, GAP: hook | — |
| `hooks/tracker_gate.py` | DROP: 결정 93 | — |
| `hooks/artifact_*` | DROP: 결정 74, Orca 참조가 대신 | — |
| `hooks/install_hint.py` | DROP: doctor 가 대신 | — |
| `hooks/orchestrator_guard.py` | DROP: 깊이 검사는 `core/start` | — |
| `hooks/refusals.py`, `request_log.py` | DROP: `gate_denied` event 가 대신 | — |
| `hooks/brief_pane.tsx`, `clear_band.tsx`, `mods.tsx` | `orca-plugin/panel`, `core/brief/panel.ts` | 예: 패널 · 상태 표시줄 캡처(항목 7, 패널은 FAIL) |
| `scripts/card.py` | `core/start`, `test/lineage/start.test.ts` | 예: lineage 시험 두 Run 녹색 |
| `scripts/end_check.py` | `claude-plugin/skills/end-session` | 아니오(항목 10, 손으로 닫음) |
| `scripts/sync.py` | `sangsoe install`, `core/install` | 아니오(brew 설치는 오케스트레이터 쪽) |
| `scripts/setup.py` · `bootstrap.py` · `recommended-settings.json` | `core/install`, `install` · `doctor` | 예: doctor |
| `scripts/catalog` | DROP: 번역 카탈로그 없음(R-22) | — |
| `scripts/ci_*` 와 시험 | `.github/workflows/ci.yml`, `test/layout.test.ts` 등 | 아니오(smoke 밖, CI 는 PR 마다) |
| `scripts/skill_tokens.py` · `skill_budget.json` | GAP: 측정 · 상한 시험 없음 | — |
| `scripts/test_allowed_tools.py`, `test_mcp_prefixes.py` | `test/judgment-layer.test.ts` | 아니오(CI) |
| `scripts/automations.py`, `orca_job.py` | `orca-plugin/timer.ts`, monitor 명세 | 예: REAPER 타이머 라운드 |
| `scripts/reap_hard.py` | REAPER(U18) | 예: 표시 라운드(mark_only) |
| `scripts/migrate.py` 등 | DROP: 일회용, 가져오기는 `core/migrate` | 예(대응 기능): `sangsoe migrate --dry-run`(항목 9) |
| `scripts/share_server.py` 등 | DROP: 상주 서버 · 포트(D-4) | — |
| `scripts/pstack-sync.py` | DROP: 결정 74 | — |
| `bin/orch` | `cli/main.ts`(`sangsoe`) | 예: brief · todo · verify-tier · monitor · migrate · land |
| `bin/skills-sync` | `sangsoe install` | 아니오 |
| `bin/reap-hard` | REAPER(U18) | 예: 위와 같음 |
| `bin/orch-dash` | DROP: 패널이 대신(D-10) | — |
| `bin/pr-watch` | DROP: pr-monitor 가 대신 | — |
| `bin/secure-fill` · `share-server` · `preview-watch` · `preview-links` | DROP: 개인 도구 · 상주 서버(D-3, D-4) | — |
| `.claude-plugin` | `.claude-plugin/marketplace.json`, plugin 매니페스트 | 예: `sangsoe@sangsoe` 0.1.0 user scope |
| `.github` | `ci.yml`, `release.yml` | 예(간접): 0.1.0 은 release 로 나온 빌드 |
| `.gitignore` | `.gitignore` | — |
| `README.md`, `INSTALL.md` | `README.md` | 예: 등급 설정 예시를 그대로 씀 |
| `README.ja.md`, `README.ko.md` | DROP: 번역본 없음(R-22) | — |
| `AGENTS.md`, `CLAUDE.md`, `intent.md` | `docs/architecture.md` | — |
| `CONTRIBUTING.md`, `SECURITY.md` | DROP: 필요해지면 새로 씀 | — |
| `LICENSE` | DROP: 오너가 정할 일 | — |
| `docs` | `docs/` | — |
| `evals` | `claude-plugin/skills/brief/evals`, `general` | 아니오 |
| `tsconfig.json` | `tsconfig.json` | — |
| `types` | DROP: mod 가 없음 | — |
| `vendor` | DROP: 결정 74 | — |

## 10. 닫기: worker_done → release → 카드 닫힘, REAPER 표시

P2: 머지 뒤 워커가 `worker_done` succeeded 를 보냈고, 리드도 오케스트레이터에게 `worker_done` 을 보냈다(msg_a0a98161c867). 두 Dispatch 는 `succeeded · settled` 가 됐지만 터미널은 `retained` 로 남았다. 자동 release 는 없다: core 에 `workerRelease` 를 부르는 곳이 없고, 리드는 "닫으라" 는 요청에 sangsoe:orchestrate 표를 따라 아무 도구도 부르지 않았다("its table entry lists no tool to call").

닫힌 Dispatch 를 쥔 채 쉬는 세션이 입력을 기다리면 sangsoe 알림이 Orca 에 거부된다:

```
Rejected escalation: task_fa401bcde518: 사람 입력 대기
Orca rejected this escalation: No active Dispatch belongs to this message sender. (sender_not_assignee)
```

격리가 끝난 뒤(03:31:58Z) 하네스의 요청으로 손으로 닫았다:

```
리드: worker-release --dispatch ctx_50d97ec8bc47 → terminalState released, liveness exited
오케스트레이터: worker-release --dispatch ctx_08db458f8b2d → terminalState released
terminal close: 오케스트레이터 · 빈 셸 · 교차 저장소 오케스트레이터 · 빈 셸 → ptyKilled true ×4
worktree rm --delete-branch: basketstar · emperor · p2-orch · p2-xrepo → removed true ×4(지우기 전 넷 다 미커밋 0, main 밖 커밋 0)
```

REAPER 표시 라운드: 재시작 뒤 타이머 round 125(03:32:38Z) `roots_ok: false · mark_only · cards 20 · marked 11 · reaped 0`. 표시 전용 dry run 의 `unseen` 에 smoke 저장소는 없다(리허설의 소문자 결함이 사라짐). 남은 `unseen` 은 다른 소유자의 저장소 3개다.

판정: FAIL (worker_done 뒤 자동 release 가 없고 닫기 길도 정해져 있지 않아 손으로 닫음. REAPER 의 smoke 저장소 읽기는 PASS)

### 리허설(rc.4)

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

리허설 판정(rc.4): PASS (손으로 release. 소문자 PR 읽기는 finding)

## S6 의존 관리 smoke (실행 체크리스트, 준비: U80)

S6 는 의존 관리를 실제 GitHub 와 실제 Orca 에서 잰다: PR 3개 stack(`stacked_on`) 과 `after` 간선 하나를 걸고, 아래에서부터 land 하며 단계마다 event 행 · land 거부 글 · 패널의 "왜 준비되지 않았나" 행 · 크리티컬 패스를 읽는다. 이 절은 실행 전의 틀이다. 실행하면 단계마다 "본 것" 칸을 채우고 판정을 `PASS` · `FAIL` · `NOT VERIFIED`(이유) 로 적는다. 위 1–10 항목과 같은 판정 줄 꼴은 실행 기록을 이 절 아래에 더할 때 쓴다(`test/e2e/smoke/smoke-run.test.ts` 는 숫자로 시작하는 `## ` 절만 센다).

### 고정물 (JeongJaeSoon/sangsoe-smoke, U79 가 만듦)

| 이름 | PR | head 브랜치 → base | 바꾼 것 | 첫 head |
|---|---|---|---|---|
| A | #3 | `s6/a` → `main` | `docs/s6-a.md` 새 파일 3줄 | `78dbc6da` |
| B | #4 | `s6/b` → `s6/a` | `docs/s6-b.md` 새 파일 3줄 | `235f9a9a` |
| C | #5 | `s6/c` → `s6/b` | `docs/s6-c.md` 새 파일 3줄 | `4c7e3054` |
| D | #6 | `s6/d` → `main` | `docs/s6-d.md` 새 파일 3줄 | `fbda6d6b` |

넷 다 draft 가 아닌 보통 PR 이다(land 는 draft 를 `pr_not_open` 으로 거부한다, `core/land/land.ts:156-159`). 모두 `docs/` 만 바꿔 오너 설정의 `docs_globs` 로 V0 이고, 그래서 증거 행이 필요 없다(V0 은 필수 CI 만). 저장소에는 workflow 가 없고 GitHub 에는 skip 하는 CodeRabbit 상태 하나만 붙는다. P2 의 #2 가 같은 저장소에서 `merge_verdict` 로 머지됐으니 이 rollup 은 통과로 읽힌다(항목 3). 저장소 설정은 `delete_branch_on_merge: false`, 브랜치 규칙 없음이다.

### 설치: 사전 릴리스 빌드 (오너 결정 A)

S6 는 U75 · U78 이 머지된 뒤의 사전 릴리스(`v0.1.4-rc.1`)에서 돈다. 안정 formula 는 건드리지 않는다. 아래 brew 단계는 모두 실행 전이다(NOT VERIFIED).

1. 버전 PR: sangsoe 저장소에서 `0.1.4-rc.1` 로 올리는 PR. 0.1.3 의 릴리스 커밋(6a18cfd)처럼 `package.json` · `package-lock.json` · `claude-plugin/.claude-plugin/plugin.json` · `orca-plugin/orca-plugin.json` 의 버전을 함께 올리고 `CHANGELOG.md` 에 그 절을 둔다. 두 manifest 가 `package.json` 과 다르면 `test/release.test.ts:10-16` 이 CI 에서, doctor 의 tree 점검(`core/install/doctor.ts:76-81`)이 릴리스 smoke 에서 멈춘다. 리드가 그 PR 의 리뷰를 land 전에 `sangsoe review record --pr <버전 PR> --head <리뷰한 head> --act-on 0 --reviewer claude-fresh-context` 로 기록한다(land 가 이 판정을 요구하고, 4 의 `plugin approve` 도 같은 기록을 읽는다). 릴리스 workflow 는 태그가 `v` + `package.json` 버전과 다르면 멈춘다(`.github/workflows/release.yml:31-41`).
2. 태그: 그 PR 의 머지 커밋에 `v0.1.4-rc.1` 을 달아 push 한다. 버전에 `-` 가 있으면 workflow 가 `prerelease=true` 로 정하고(`release.yml:42-47`) `gh release create … --prerelease` 로 낸다(`release.yml:100-101`). 확인: `gh release view v0.1.4-rc.1 --json isPrerelease` 가 `true`, 릴리스 run 의 smoke 단계가 `ok tree: … (sangsoe 0.1.4-rc.1)` 를 찍는다.
3. tap: `JeongJaeSoon/homebrew-tap` 에 새 파일 `Formula/sangsoe-rc.rb`(class `SangsoeRc`)를 더하는 PR 하나. 내용은 지금의 `Formula/sangsoe.rb` 와 같고 셋만 다르다: `url` 은 `…/releases/download/v0.1.4-rc.1/sangsoe-0.1.4-rc.1.tar.gz`, `sha256` 은 릴리스의 `.sha256` asset(내려받은 tarball 로 다시 계산해 같은지 본다), 그리고 `conflicts_with "sangsoe", because: "both install the sangsoe command"`. `Formula/sangsoe.rb` 는 0.1.3 그대로 둔다. tap 의 workflow 는 agent-guard formula 에만 반응해 이 PR 에서는 CI 가 돌지 않는다.
4. 설치(세션 밖 터미널에서, 오너 또는 오케스트레이터):
   - `brew unlink sangsoe` → `brew install jeongjaesoon/tap/sangsoe-rc` → `sangsoe --version` 이 `sangsoe 0.1.4-rc.1`. `conflicts_with` 가 unlink 만으로 풀리지 않으면 README Uninstall 순서대로 0.1.3 을 지운다(저장소 · 설정은 남는다).
   - `sangsoe install`: wrapper 가 `SANGSOE_ROOT` 를 `opt/sangsoe-rc/libexec` 로 넘기므로(`core/install/host.ts:46-50`) Claude marketplace 와 Orca plugin 이 그 경로로 다시 등록되고 Orca 는 `approval waits — fingerprint <지문 id>` 를 낸다.
   - 승인: 1 에서 기록한 버전 PR 의 리뷰를 읽어 오케스트레이터가 `sangsoe plugin approve --dry-run` 으로 지문과 세 점검을 보고 → `sangsoe plugin approve` → `sangsoe doctor` 종료 코드 0, `orca plugin: local.sangsoe 0.1.4-rc.1, running`.
   - 떠 있던 Claude 세션은 다시 띄운다. 설치본과 버전이 다른 MCP 서버는 `start_unit` 이 `server_stale` 로 거부한다(결정 211).
5. 되돌리기: S6 가 PASS 면 v0.1.4 안정판의 tap PR 이 `Formula/sangsoe.rb` 를 올리고 `Formula/sangsoe-rc.rb` 를 지운다. 설치본은 formula 의 caveat 대로 `sangsoe uninstall` 을 먼저 하고 `brew uninstall sangsoe-rc` → `brew link sangsoe`(또는 `brew upgrade sangsoe`) → `sangsoe install` → 승인 → `sangsoe doctor`. FAIL 이면 같은 순서로 0.1.3 에 돌아간다.

### 실행 전 조건

| 조건 | 확인 명령 | 통과 규칙 |
|---|---|---|
| 설치본이 rc 다 | `sangsoe --version` · `sangsoe doctor` | `0.1.4-rc.1`, doctor 종료 코드 0 |
| U75 · U78 이 그 빌드에 있다 | `git log --oneline v0.1.4-rc.1` 에 두 단위의 머지 커밋 | 둘 다 있음 |
| 격리 | P2 "환경" 과 같다: 세션을 띄우기 직전마다 `CLAUDE_CODE_PLUGIN_DIRS` 가 `''`, 세션 transcript 의 `agent-skills:` skill 0 | 세 세션 모두 0 |
| land 가 verdict 로 머지해도 되는 저장소 | `~/.config/sangsoe/config.json` 의 `verdict_merge_repos` 에 `JeongJaeSoon/sangsoe-smoke` | 있음. 지금은 없다: 오너가 S6 동안만 더하고 끝에 뺀다 |
| pr-monitor 가 smoke 저장소를 본다 | 같은 파일의 `watch.repos` | 있음. 지금은 `watch` 키가 없다. P2 처럼 scratch home 에 두면 아래 `sangsoe monitor run` 마다 `--home <scratch>` 를 붙인다 |
| land 가 squash 로 머지한다 | `gh api repos/JeongJaeSoon/sangsoe-smoke --jq .allow_squash_merge` | `true`(land 는 squash 를 먼저 고른다, `core/land/github.ts:162-168`. 11 · 14 의 patch-id 기대가 여기에 기댄다) |
| smoke clone | 워커 worktree 가 아닌 scratch 의 `git clone https://github.com/JeongJaeSoon/sangsoe-smoke.git`(9 · 11 · 13 · 14 에서 `git switch` 와 push 를 하는 곳. 워커 worktree 가 같은 브랜치를 쥐고 있어 그 저장소의 다른 worktree 에서는 switch 가 안 된다) | clone 이 있음 |
| 고정물이 그대로다 | `gh pr view <3..6> -R JeongJaeSoon/sangsoe-smoke --json state,baseRefName,headRefOid` | 위 표와 같음, 넷 다 OPEN |

### 단계

각 단계의 "볼 것" 은 같은 넷을 읽는다. event 는 저장소를 읽기 전용으로 연다:

```
sqlite3 -readonly ~/.local/share/sangsoe/sangsoe.db "select seq, ts, type, after from event where seq > <앞 단계의 마지막 seq> and (subject like '%sangsoe-smoke%' or after like '%sangsoe-smoke%' or type in ('edge_added','edge_removed')) order by seq"
sangsoe brief <리드 묶음>          # 크리티컬 패스 · 의존 · "왜 준비되지 않았나" 표 (패널 묶음 상세와 같은 모델)
sangsoe graph critical --run <리드 Run> --lead <리드 묶음>
orca plugin shot local.sangsoe --panel brief --width 360 --json
```

패널은 html 이라 `plugin shot --act` 로 묶음 상세를 열 수 없다(항목 8). 묶음 상세 화면은 오너가 한 번 눌러 연 상태로 shot 을 찍고, 못 찍은 단계는 `sangsoe brief <리드 묶음>` 출력으로 대신하고 그렇게 적는다. `--lead` 에는 항목에 저장된 리드 이름을 그대로 쓴다(다르면 "끝나지 않은 항목 없음").

읽기 전에 알아 둘 두 규칙:

- 왜 표의 간선 행은 Task 가 `pending` · `ready` 인 항목만 낸다(`core/graph/ready.ts:217`, `core/brief/build.ts:323`). 워커가 붙어 `dispatched` 가 된 항목은 간선이 막고 있어도 행이 없다. 그래서 간선의 왜 행은 워커를 열기 전(2단계)에 읽는다. 예외 하나(결정 215 ④): Task 가 끝났고(`completed`) PR 이 열려 있는 항목은, 그 PR 의 base 가 바뀐 뒤 리뷰가 없으면 재리뷰 행 하나를 낸다(`core/graph/ready.ts:192-215`). 10 단계가 이 행을 읽는다.
- 크리티컬 패스는 끝나지 않은 Task 사이의 항목 → 항목 간선만 잇는다(`core/graph/critical.ts:35-49`). PR 이 선행인 `stacked_on` 은 경로에 들어가지 않는다. 그래서 `after` 간선은 항목 B → 항목 D 로 건다.

| # | 하는 일 (누가 · 명령 또는 도구) | 볼 것 | 통과 규칙 |
|---|---|---|---|
| 1 | 오케스트레이터를 smoke 저장소의 Orca worktree 에서 띄운다(`start_unit` 은 자식을 부모의 저장소에 연다, P2 "교차 저장소"). `run-create` → `item_create`(role lead) → `start_unit`(lead) | 리드 Run id, 리드 묶음 이름 | 리드가 smoke 저장소 worktree 에 열림 |
| 2 | 리드가 항목 넷(A · B · C · D)을 `item_create` 한다(아직 시작하지 않는다). 그리고 `edge_add {pred: "<B 의 iNNN>", succ: "<D 의 iNNN>", kind: "after", runs: ["<리드 Run>"]}` | `edge_added{kind: after}` 한 행. `sangsoe graph why <D 의 iNNN> --run <리드 Run>`: 한 행(선행 B 항목, after, B 의 상태, "선행 항목이 끝나기를 기다린다", `core/graph/ready.ts:117`). `sangsoe brief <리드 묶음>`: 의존 한 줄, 왜 표에 D 한 행(같은 묶음의 선행이라 해야 할 일 칸은 B 의 다음 할 일, `core/brief/build.ts:327-329`), 크리티컬 패스 `B → D`. 패널 shot | 그 행들과 그 경로가 나옴. 패널 숫자가 `sangsoe brief` 와 같음 |
| 3 | 리드가 `start_unit` 으로 워커 넷을 연다(`after` 는 선행 Task 가 끝난 뒤에만 시작을 잡으므로 D 도 열린다, `core/start/start.ts:122`). 워커마다 자기 worktree 에서 `git switch s6/<a·b·c·d>` 만 하고 push 하지 않는다. 브랜치 하나에 worktree 하나여야 한다. 그 뒤 `sangsoe monitor run pr` 두 라운드 | 첫 라운드는 Orca 링크가 없어 `task` 없는 `pr_opened` 를 쓰고 브랜치 worktree 에 PR 참조를 더한다(`core/detect/pr/round.ts:233-240`, `:336-353`). 다음 라운드가 `task` 를 실은 `pr_opened{pr, task, base, head_sha, head}` 를 더한다(`head` 는 같은 저장소의 head 브랜치, 4단계의 stack 추론이 읽는다). 왜 표는 이제 0행(네 Task 가 `dispatched`) | `task` 를 실은 `pr_opened` 넷, 각각 그 항목의 Task id 이고 서로 다름. `task` 없는 행만 있으면 FAIL(뒤 단계의 간선이 걸릴 곳이 없다) |
| 4 | `stacked_on` 자동 생성(U75 G22): `sangsoe monitor run queue` 한 라운드 | `edge_added{pred: pr:jeongjaesoon/sangsoe-smoke#3, succ: item:<B task>, kind: stacked_on}` 과 #4 → C 의 행. `sangsoe brief` 의 의존 세 줄(PR 선행은 "외부 선행"). 크리티컬 패스는 `B → D` 그대로. 라운드의 `calls` 에 `graph sync: added 2, …`(`core/detect/queue/round.ts:66-67`). 이 손 라운드 전에 plugin 타이머의 queue 라운드가 이미 돌았으면 `added 0` 이고 두 행은 이미 있다 | 두 행이 손 없이 생김. queue 라운드는 `syncGraph(…, { infer: true })` 로 부르고, 추론은 열린 PR 의 base 브랜치가 다른 열린 PR 하나의 head 브랜치일 때 그 PR 위에 쌓였다고 본다(`core/graph/sync.ts:31-49`, U75 · 결정 212). 생기지 않으면 FAIL 로 적고 오늘 있는 손 길로 이어 간다: `sangsoe graph sync --run <리드 Run> --stack jeongjaesoon/sangsoe-smoke#4=jeongjaesoon/sangsoe-smoke#3 --stack jeongjaesoon/sangsoe-smoke#5=jeongjaesoon/sangsoe-smoke#4`(`cli/commands/graph-sync.ts:24`). 손 길도 `task` 를 실은 `pr_opened` 가 있어야 간선을 더한다(`core/graph/sync.ts:60-67`) |
| 5 | 리드(작성자 아님)가 네 PR 의 지금 head 에 verdict 를 남긴다: `sangsoe review record --repo JeongJaeSoon/sangsoe-smoke --pr <N> --head <sha> --act-on 0 --reviewer smoke-lead`(이름은 `[A-Za-z0-9][A-Za-z0-9_.-]*` 만 받는다, `core/approve/review-verdict.ts:11`) | `review_verdict` 넷 | 넷, 각 head 가 `gh pr view` 의 `headRefOid` 와 같음 |
| 6 | 순서 가드: B 와 C 를 먼저 land 해 본다(머지하지 않게 `--dry-run`): `sangsoe land --repo JeongJaeSoon/sangsoe-smoke --pr 4 --dry-run --json`, `--pr 5` 도 | 거부 code `stack_order`, fix 가 `land jeongjaesoon/sangsoe-smoke#3 first` (`core/land/land.ts:169-172`). `land_failed` 행은 dry run 이라 없다 | 둘 다 `stack_order` 이고 #3 을 이름. 0.1.3 까지의 land 는 GRAPH 가 쓰는 마디 이름(`pr:…` · `item:…`)을 읽지 못해 이 거부가 나지 않았다. U75(결정 212)가 두 이름 꼴과 옛 맨 id 를 함께 읽게 고쳤다(`land.ts:370-422`). 거부가 나지 않으면 FAIL 이고, 실제 land 를 하면 B 가 `s6/a` 에 머지되므로 S6 를 멈춘다 |
| 7 | D 의 `after`: `sangsoe land --repo JeongJaeSoon/sangsoe-smoke --pr 6 --dry-run --json` | land 는 `after` 간선을 읽지 않는다(`land.ts:388` 은 `stacked_on` 만). 거부가 아니면 결과의 action 을 적는다 | 관찰만(오너가 분류할 finding): D 의 순서는 2단계의 왜 행과 크리티컬 패스로만 보이고 land 는 막지 않는다. 결과가 이와 다르면 그 글을 그대로 적는다 |
| 8 | A 를 land: `sangsoe land --repo JeongJaeSoon/sangsoe-smoke --pr 3 --head <A head> --json`(P2 처럼 auto mode 가 막으면 오너의 `!` 줄) → `sangsoe monitor run pr` | action `merge_verdict`, `land_requested` · `pr_merged` 행, A Task 의 `task-update completed`(또는 "already completed"). 크리티컬 패스는 `B → D` 그대로(A 는 경로에 없었다) | 머지 커밋이 main 에 있고 위가 모두 맞음 |
| 9 | retarget: `gh pr edit 4 --repo JeongJaeSoon/sangsoe-smoke --base main`. 그 뒤 `sangsoe monitor run pr`. smoke clone 에서 `git push origin --delete s6/a` 로 지우면 GitHub 가 retarget 하지 않고 #4 를 닫는다(아래 실행 기록 9). land 는 `gh pr merge` 로 머지하고 브랜치를 지우지 않는다(`core/land/ports.ts:46-52`) | `gh pr view 4 --json baseRefName,reviews` 의 base 가 `main`. `pr_base_changed{pr: …#4, from: s6/a, to: main}`(`core/detect/pr/round.ts:243-250`). 승인 해제: 위 `reviews` 의 APPROVED 가 DISMISSED 로 바뀜 | base 가 main 이고 `pr_base_changed` 한 행. 승인 해제는 네 PR 의 작성자가 같은 계정이라 작성자가 아닌 계정이 9 전에 B 를 승인했을 때만 잴 수 있다. 없으면 NOT VERIFIED(승인할 다른 계정 없음) |
| 10 | G31 재리뷰 막음(U78, 결정 215), head 가 아직 그대로일 때: 리드 세션에서 `sangsoe monitor run queue` 한 라운드(리드 Run 에 묶이지 않은 세션의 라운드는 그 Run 을 읽지 못해 항목을 만들지 못한다, 아래 실행 기록 10) → `sangsoe land --repo JeongJaeSoon/sangsoe-smoke --pr 4 --dry-run --json` · `sangsoe graph why <B 의 iNNN> --run <리드 Run>` · `sangsoe brief <리드 묶음>` · 패널 shot | queue 라운드의 `calls` 에 `graph sync: added 0, unstacked 1, …`(#3 → B 의 `stacked_on` 을 뺀다: 선행 #3 의 head `s6/a` 가 #4 의 옛 base 였고 지금 base 가 아니다, `core/graph/sync.ts:58-82`)와 `rereview items: made 1 (jeongjaesoon/sangsoe-smoke#4 → iNNN), refused 0`(`core/detect/queue/round.ts:66-72`). event 에 그 `edge_removed` 한 행, 재리뷰 항목의 `item_created`(title `re-review jeongjaesoon/sangsoe-smoke#4`, done_when `a review of jeongjaesoon/sangsoe-smoke#4 recorded after its base moved from s6/a to main`, `core/land/rereview.ts:22`), B 항목에 `lead` · `priority` · `repo` 가 있을 때만 그것을 옮긴 `item_extra_set`, 재리뷰 항목 → B 항목의 `edge_added{kind: blocks}`(`core/graph/rereview.ts:38-75`). land 는 거부 code `rereview_needed`, 글 `jeongjaesoon/sangsoe-smoke#4's base moved from s6/a to main and no clean review was recorded after it (re-review item iNNN)`, fix `review the head <B head 7자> and record the verdict with sangsoe review record`(`core/land/land.ts:442-449`). 리뷰 판정(`land.ts:192`)이 `behind_base`(`land.ts:290-301`)보다 먼저 돌므로 B 가 main 뒤에 있어도 이 code 가 나온다. 왜 행: B 의 Task 가 `completed` 이고 PR 이 열려 있을 때만 B 에 한 행(선행은 재리뷰 항목, 종류 `blocks`, 상태 `재리뷰 전: base s6/a → main`, 해야 할 일 `PR 의 지금 head 를 리뷰하고 review_record 로 기록한다`). B 의 워커가 아직 일하는 중이면 B 의 행은 0 이고 그렇게 적는다. 재리뷰 항목 자신은 들어오는 간선이 없어 행이 없다. 크리티컬 패스: 재리뷰 항목 → B 가 항목 → 항목 간선이라 둘 다 끝나지 않았으면 `재리뷰 → B → D` | land 가 `rereview_needed` 로 G31 막음을 이름. S6 에서 G31 을 가르는 단계는 이것 하나다: 0.1.3 까지는 head 가 같으면 base 가 바뀌어도 head 에 묶인 verdict 가 그대로 통하고 거부는 `behind_base` 뿐이다. `behind_base` 만 나오면 FAIL. queue 라운드가 `rereview items: made 0` 이고 그 전에 만든 항목도 없으면 FAIL |
| 11 | `behind_base` 풀기: smoke clone 에서 `git switch s6/b && git merge origin/main && git push`(A 는 squash 로 들어가 같은 파일을 같은 내용으로 더하므로 충돌 없음) → `sangsoe monitor run pr` → `sangsoe land --repo JeongJaeSoon/sangsoe-smoke --pr 4 --dry-run --json` | 새 head. land 는 다시 `rereview_needed`(10 과 같은 글, fix 의 head 만 새 head): base 변경 뒤 판정이 하나도 없으면 `reviewed` 가 patch-id 를 보기 전에 거부한다(`land.ts:438-449`). 결정 215 앞의 빌드에서는 옛 base `s6/a` 가 9 에서 지워져 그 비교가 404 라 patch-id 를 못 내고 `review_stale` 이었다 | 기록만: G31 판정은 10 이 한다. `rereview_needed` 가 아니면 그 글을 그대로 적는다 |
| 12 | 새 head 를 리뷰해 기록: 5 와 같은 기록(`review_record` 또는 `sangsoe review record --repo JeongJaeSoon/sangsoe-smoke --pr 4 --head <새 head> --act-on 0 --reviewer smoke-lead`) → land B: `sangsoe land --repo JeongJaeSoon/sangsoe-smoke --pr 4 --head <새 head> --json` → `sangsoe monitor run pr` → 리드가 재리뷰 항목을 `orca orchestration task-update --status completed` 로 닫는다 | `review_verdict` 한 행(seq 가 `pr_base_changed` 뒤, dedupe 열쇠 끝에 base 변경 수 `1`, `core/approve/review-verdict.ts:45-53`), `merge_verdict`, `pr_merged`. 재리뷰 항목은 land 도 pr-monitor 도 닫지 않는다(land 는 event 로 판정하고 항목 상태를 읽지 않는다, 결정 215 ③). 닫은 세션과 그 `item_transition` 을 적는다. B 의 워커가 끝나 Task 가 닫히면 크리티컬 패스에서 B 가 빠짐 | 기록 하나로 막음이 풀리고 머지됨 |
| 13 | C 를 같은 길로: `gh pr edit 5 --repo JeongJaeSoon/sangsoe-smoke --base main` → 9 · 10 · 11 · 12 를 #5 에. B 가 머지되어 main 이 움직이면 #5 에 main 을 한 번 더 합치고, 그 새 head 는 patch-id 가 달라(`review_stale`) 리뷰를 다시 기록한다 | 9–12 와 같은 넷 | 9–12 와 같은 규칙 |
| 14 | D 를 land: base 는 처음부터 main 이라 retarget 이 없다. `git switch s6/d && git merge origin/main && git push` → `sangsoe land --repo JeongJaeSoon/sangsoe-smoke --pr 6 --head <새 head> --json` → `sangsoe monitor run pr` | `behind_base` 뒤 새 head. 리뷰 판정은 patch-id 로 옛 verdict 를 잇지만(`land.ts:453-457`), verdict 로 바로 머지하는 길은 그 head 자체의 판정을 요구해(`land.ts:308-312`, 결정 158) `verdict_not_at_head` 로 거부한다. 새 head 에 `review_record` 를 한 번 더 남기고 land 하면 `merge_verdict`, `pr_merged`. D 에는 재리뷰 항목이 생기지 않음(base 가 바뀌지 않았다). 끝에 크리티컬 패스 "없음" | D 에 G31 막음이 없고, 새 head 의 기록 하나로 머지됨. 열린 S6 PR 0 |

### 닫기 (P2 항목 10 과 같은 길)

| 대상 | 명령 | 확인 |
|---|---|---|
| 워커 넷 · 리드 | 각자 `worker_done`, 남은 Dispatch 는 `orca orchestration worker-release --dispatch <id>` | `terminalState released` |
| 터미널 | `orca terminal close` (오케스트레이터 · 빈 셸) | `ptyKilled true` |
| worktree | `orca worktree rm --worktree id:<id> --delete-branch` 넷 + 리드 + 오케스트레이터 | 지우기 전 미커밋 0, main 밖 커밋 0 |
| 원격 브랜치 | 넷 다 머지된 뒤 `git push origin --delete s6/a s6/b s6/c s6/d` | `git ls-remote origin 's6/*'` 가 빈 출력 |
| PR | 넷 다 머지됨. 실행이 중간에 멈추면 남은 PR 은 열린 채 두고 보고에 적는다 | `gh pr list -R JeongJaeSoon/sangsoe-smoke --state open` 에 S6 PR 없음 |
| 머지 없이 닫힌 PR 의 항목 | 실행이 일부러 닫은 PR 의 항목마다 `sangsoe item retire <iNNN> --reason "<왜 닫았나>" --by <owner 또는 lead:<묶음>>`(리드 세션은 MCP `item_retire`, 결정 223) | `sangsoe brief` 의 🚧 에 그 항목이 없고, 항목이 모두 끝난 묶음이 목록에 없음 |
| 설정 | `verdict_merge_repos` · `watch.repos` 에 더한 smoke 저장소를 뺀다 | `sangsoe doctor` 의 `tier-config` · `watch-repos` 행이 S6 전과 같음 |
| Orca 저장소 등록 | Orca CLI 에 내리는 명령이 없어 남는다(준비 순서 1) | 보고에 적음 |
| scratch clone | 휴지통으로 | 없음 |
| 설치본 | 위 "설치" 5 | `sangsoe doctor` 종료 코드 0 |

### S6 실행 기록 (2026-11-11 JST, 설치본 0.1.4-rc.1)

설치: 버전 PR #93(머지 4e5a3f47) 에 서명 태그 `v0.1.4-rc.1`, release run 의 smoke 가 `ok tree: … (sangsoe 0.1.4-rc.1)`, `gh release view` 가 pre-release. tap 에 `Formula/sangsoe-rc.rb`(tap PR 37, `sangsoe land` 로 `merge_verdict`). `brew unlink sangsoe` 만으로 `conflicts_with` 가 풀렸다(0.1.3 keg 는 남음). `sangsoe install` → `approval waits — fingerprint ap1-390ea2b4…`, `sangsoe plugin approve --dry-run` 의 세 점검 ok(`merged_with_clean_review: on main via PR #93`), 오너가 approve, `sangsoe doctor` 종료 코드 0 과 `orca plugin: local.sangsoe 0.1.4-rc.1, running`. `brew style` · `brew test` 는 gem 설치가 인증서로 실패해 NOT VERIFIED.

실행 전 조건: 고정물 넷 OPEN · 첫 head 그대로, `allow_squash_merge` true, `git log v0.1.4-rc.1` 에 U75(195498d) · U78(9556001), `verdict_merge_repos` · `watch.repos` 에 smoke 저장소(오너가 S6 동안 더함). 격리: 세 세션 모두 `CLAUDE_CODE_PLUGIN_DIRS` 빈 값으로 띄웠으나 profile 의 enabledPlugins 로 agent-skills 가 목록에 보였다. 리드 transcript 의 agent-skills Skill 호출 0, orch · skills-sync 명령 0. 목록 노출 때문에 격리는 NOT VERIFIED(목록에 보임)로 둔다.

세션: MCP 도구는 설치 뒤 새로 띄운 두 세션이 불렀다. 오케스트레이터 세션(smoke 저장소의 Orca worktree)이 `run-create` · `item_create` · `start_unit`(lead), 리드 세션이 `run-create`(자기 Run) · `item_create` 넷 · `edge_add` · `start_unit`(worker) 넷 · `review_record` 여덟 번 · 재리뷰 항목 닫기. CLI 단계(`monitor run` · `land` · `graph` · `brief` · git push · `gh pr edit`)는 U81 워커 세션이 0.1.4-rc.1 CLI 로 했고, 10 의 queue 라운드 하나만 리드 세션이 돌렸다.

| # | 본 것 | 판정 |
|---|---|---|
| 1 | 오케스트레이터 Run `run_c7c0c67f7f60`, 리드 항목 i008. 첫 `start_unit` 은 `lineage_invalid`(지시 목록에 `worktreeId` 가 빠짐, 세션이 Orca worktree 안에 있었다). `worktreeId` 를 넣은 호출로 `started`, 리드는 smoke 저장소 worktree 에 열림 | PASS |
| 2 | 부모 Run 에 낸 `item_create` 넷은 `worker_cannot_coordinate_own_run` 으로 거부, 리드가 자기 Run `run_c383e120c387` 을 만들어 i009–i012 를 만들었다. `edge_added{kind: after}` 한 행. `graph why i012`: 한 행(`item:…` B, after, 📅 예정, "선행 항목이 끝나기를 기다린다"). `graph critical --run`: `i010 → i012`. `sangsoe brief` · 패널: 묶음 0(리드 Run 을 읽지 않는다). `--run run_c383…` 을 주면 "그 외" 묶음에 의존 한 줄, 왜 표 i012 한 행, 크리티컬 패스 `i010 → i012`. `--lead lead:s6` 는 "끝나지 않은 항목 없음"(항목에 lead 칸이 없다) | FAIL (graph 는 맞고, 패널과 `--run` 없는 brief 가 리드 Run 을 못 본다) |
| 3 | plugin 타이머의 첫 라운드가 `task` 없는 `pr_opened` 넷, 손 라운드가 `task` 를 실은 `pr_opened` 넷(Task id 서로 다름, `head` 있음). D 는 B 가 끝나기 전에도 열렸다(`after` 는 끝난 선행만 잡는다, `core/start/start.ts:110-123`) | PASS |
| 4 | queue 라운드 `graph sync: added 2, …`, `stacked_on` 두 행(#3 → B, #4 → C), brief 의 외부 선행 두 줄 | PASS |
| 5 | `review_verdict` 넷, head 가 `headRefOid` 와 같음 | PASS |
| 6 | #4 · #5 dry run 둘 다 `stack_order`, fix `land jeongjaesoon/sangsoe-smoke#3 first` | PASS |
| 7 | #6 dry run 은 `merge_verdict`(land 는 `after` 를 읽지 않는다) | 관찰 |
| 8 | #3 `merge_verdict`, `land_requested` · `pr_merged`. pr 라운드의 A `task-update completed` 는 워커 세션에서 `consumer_fenced`(그 Run 에 묶이지 않음), 리드 세션에서 `task_not_startable`(워커 Dispatch 가 열림). A 워커의 worker_done 뒤 completed | PASS |
| 9 | `git push origin --delete s6/a` 에 GitHub 가 #4 를 retarget 하지 않고 닫았다(base `s6/a` 그대로). `pr_closed` 가 남고 store 는 다시 열린 PR 을 읽지 않는다 | FAIL (체크리스트 전제) |
| 9b | 복구: `s6/a` 를 옛 head 로 다시 push → `gh pr reopen 4` → `gh pr edit 4 --base main`, `gh pr edit 5 --base main`. `pr_base_changed` 두 행(s6/a → main, s6/b → main). 승인 해제는 승인한 다른 계정이 없어 NOT VERIFIED | PASS |
| 10 | #5: 리드 세션의 queue 라운드가 `rereview items: made 1 (jeongjaesoon/sangsoe-smoke#5 → i013)`, `item_created` · `edge_added{kind: blocks}`. land `rereview_needed … (re-review item i013)`, `graph why i011` 이 재리뷰 항목 행. 워커 세션의 queue 라운드는 `refused 1`(리드 Run 을 읽지 못함), `unstacked 1`(#4 → C). #4: land `rereview_needed`(항목 없음), 왜 행 없음(닫힌 PR 로 읽힘) | FAIL (#5 는 리드 세션에서만, #4 는 닫힘 표시 때문에 항목 없음) |
| 11 | main 을 합친 새 head 에서 #4 · #5 둘 다 `rereview_needed` | PASS |
| 12 | #4 의 새 head 에 기록 → `merge_verdict`, `pr_merged`, B Task "already completed" | PASS |
| 13 | #5: B 머지로 main 이 움직여 다시 합친 head 는 `review_stale`(patch-id 다름), 그 head 에 기록 → `merge_verdict`. 리드가 i013 을 `task-update --status completed` 로 닫았다 | PASS |
| 14 | main 을 합친 #6 은 `verdict_not_at_head`(결정 158). 새 head 에 기록 → `merge_verdict`, `pr_merged`. 열린 S6 PR 0, 크리티컬 패스 "끝나지 않은 항목 없음" | FAIL (체크리스트 기대, 위 행을 고쳤다) |

닫기: 워커 넷 worker_done → worker-release 넷 `released`, 리드 Run 의 Task 다섯(재리뷰 항목 포함) completed, 리드 worker_done → 오케스트레이터 세션이 release(`released`). 원격 `s6/*` 넷을 지웠다(`ls-remote` 빈 출력). 오케스트레이터 · 리드 세션의 worktree · 터미널과 설정 되돌리기, 설치본 되돌리기는 리드 몫이다.

고침(위 기록은 본 그대로 둔다): 2 · 10 의 리드 Run 이 안 보이던 것, 9 · 10 의 다시 열린 #4 가 닫힘으로 읽히던 것, 8 뒤 위 PR 의 base 가 머지된 `s6/a` 로 남아 land 가 그 브랜치에 머지할 수 있던 것은 결정 216 이 고쳤다(`item_created.run`, `pr_reopened`, land 의 `base_merged` · `base_unrecorded`). 다음 S6 실행에서 9 의 retarget 을 하지 않으면 land 가 `base_merged` 와 `gh pr edit … --base main` fix 를 낸다.

### S6 재실행 기록 (2026-11-12 JST, 설치본 0.1.4-rc.2)

결정 216 의 세 고침을 설치본에서 잰다: 다시 연 PR(NOW-1), 머지된 아래 PR 의 브랜치를 base 로 둔 PR 의 land(NOW-2), 리드 Run 을 손 라운드 없이 읽는 monitor · brief · 패널(NOW-3).

설치: 버전 PR #96(머지 b1b901c1) 에 서명 태그 `v0.1.4-rc.2`, release run 의 smoke 가 `ok tree: … (sangsoe 0.1.4-rc.2)`, `gh release view` 가 pre-release. tap PR 38 이 `Formula/sangsoe-rc.rb` 를 rc.2 로 올렸다(`sangsoe land`, `merge_verdict`). `brew upgrade sangsoe-rc` → `sangsoe 0.1.4-rc.2`, `sangsoe install` → `approval waits — fingerprint ap1-2bf1278a…`, `plugin approve --dry-run` 세 점검 ok, 오너가 approve, `sangsoe doctor` 종료 코드 0 과 `orca plugin: local.sangsoe 0.1.4-rc.2, running`. `brew test` 는 Homebrew Ruby 의 TLS 로 NOT VERIFIED.

고정물(새로): A #7 `s6r/a` → `main`, B #8 `s6r/b` → `s6r/a`, C #9 `s6r/c` → `s6r/b`, D #10 `s6r/d` → `main`. 오케스트레이터 Run `run_aaa854d8efbb`(리드 항목 i014), 리드 Run `run_3f6a325de2b7`(i015–i018, `lead: lead:s6r`). MCP 도구는 승인 뒤 새로 띄운 두 세션이, CLI 단계는 U82 워커 세션이 0.1.4-rc.2 CLI 로 했다. 리드 세션은 queue 라운드를 두 번 중 한 번만 돌렸다(아래 10).

store 읽기: `sqlite3 -readonly` 는 여전히 `unable to open database file (14)` 이다. `sangsoe.db` 와 `-wal` 을 scratch 로 복사해 읽었다.

| # | 본 것 | 판정 |
|---|---|---|
| O3 | 오케스트레이터 세션의 `orca worktree current` 를 `[gate:delegate]` 가 막아 `worktreeId` 를 몰랐다. U82 워커가 `orca terminal list` 로 찾아 리드 경유로 넘긴 뒤 `start_unit` 이 `started` | FAIL (사람 도움 필요) |
| 2 | `item_created` 다섯 행에 `run`. `graph why i018`: 한 행(B, after, 📅 예정). `graph critical`: `i016 → i018`. `--run` 없는 `sangsoe brief` 와 패널 shot 에 `lead:s6r` 묶음(4건), `sangsoe brief lead:s6r` 에 의존 한 줄 · 왜 표 i018 한 행 · 크리티컬 패스 | PASS (NOW-3 의 brief · 패널) |
| 3 | 워커 넷 `started`. U82 의 pr 라운드가 `task` 를 실은 `pr_opened` 넷(Task id 서로 다름, `head` 있음). D 도 열렸다(`after` 는 끝난 선행만 잡는다) | PASS |
| 4 | U82 의 queue 라운드 `graph sync: added 2`, `stacked_on` #7 → i016 · #8 → i017 | PASS |
| 5 | `review_verdict` 넷(리드 세션), head 가 `headRefOid` 와 같음 | PASS |
| 6 | #8 · #9 dry run 둘 다 `stack_order`, fix `land jeongjaesoon/sangsoe-smoke#7 first` | PASS |
| 7 | #10 dry run `merge_verdict`(land 는 `after` 를 읽지 않는다) | 관찰 |
| 8 | #7 `merge_verdict` squash, `land_requested` · `pr_merged`, A Task "already completed" | PASS |
| 9 | retarget 하지 않은 #8 dry run: `base_merged`, fix `gh pr edit 8 --repo JeongJaeSoon/sangsoe-smoke --base main, then land again after pr-monitor records the base change …`. `gh pr edit` 뒤: `base_unrecorded`. pr 라운드: `pr_base_changed{from: s6r/a, to: main}`. 그 뒤: `rereview_needed`. queue 라운드가 #7 → i016 `stacked_on` 을 뺐다 | PASS (NOW-2) |
| 10 | U82 의 queue 라운드 `rereview items: made 0, refused 1`, 이유 `task_create_failed (consumer_fenced: This caller is not bound to Run run_3f6a325de2b7 …)`. plugin 타이머(2분 주기)도 5분 동안 `item_created` 0. 리드 세션의 queue 라운드가 `made 1 (jeongjaesoon/sangsoe-smoke#8 → i019), refused 0`. 그 뒤 land `rereview_needed … (re-review item i019)`, 크리티컬 패스 `i019 → i016 → i018`. B 의 왜 행은 B 의 Task 가 `dispatched` 라 없음(B 워커의 worker_done 은 PR 이 열려 있어 gate 가 막았다) | FAIL (NOW-3: 리드 Run 은 읽지만 그 Run 에 Task 를 만드는 것은 Run 에 묶인 리드 세션뿐) |
| 11 | `s6r/b` 에 main 을 합친 새 head `ccd92c4` 에서 다시 `rereview_needed` | PASS |
| 12 | 새 head 에 기록 → `merge_verdict`(ad5b97e5), `pr_merged`. pr 라운드의 B `task-update completed` 는 `consumer_fenced`, 리드가 i019 를 닫고 B 워커가 worker_done | PASS |
| NOW-1 | #9 를 `gh pr close` → pr 라운드 `pr_closed` → `gh pr reopen` → pr 라운드 `pr_reopened`. 그 뒤 store 가 #9 를 열린 PR 로 읽는다(brief 의 i017 행에 PR 링크, land 가 `stack_order`). B 머지 뒤 #9 dry run `base_merged`, retarget 뒤 `base_unrecorded`, pr 라운드 `pr_base_changed{from: s6r/b, to: main}`. U82 의 queue 라운드는 10 과 같이 `refused 1` | PASS (다시 열림). 재리뷰 항목 · 왜 행은 NOT VERIFIED(10 과 같은 원인) |
| 13–14 | 하지 않음: 10 의 FAIL 로 멈췄다. #9 · #10 은 닫았다 | NOT VERIFIED |

닫기: 워커 넷 worker_done → worker-release 넷 `released`, 리드 Run 의 Task 다섯(재리뷰 항목 포함) completed, 리드 worker_done. #9 · #10 을 닫고 원격 `s6r/*` 넷을 지웠다(`ls-remote` 빈 출력, 열린 PR 0). rc.2 설치본과 smoke 저장소 설정은 rc.3 재실행까지 그대로 둔다.

고침: 10 의 재리뷰 항목과 O3 의 `worktreeId` 는 결정 217 이 고쳤다. 막힌 재리뷰 항목은 리드 Run 을 깨워 리드가 만들고, 오케스트레이터는 `worktreeId` 를 비워도 된다. 다음 재실행은 rc.3 에서 10 · NOW-1 의 재리뷰 항목과 왜 행, O3 만 다시 잰다.

### S6 두 번째 재실행 기록 (2026-11-12 JST, 설치본 0.1.4-rc.3)

결정 217 · 218 을 설치본에서 잰다: 오케스트레이터의 `worktreeId` 없는 `start_unit`(O3), 손 라운드 없이 리드 Run 에 생기는 재리뷰 항목(NOW-3(b)), 다시 연 PR 의 재리뷰 항목과 왜 행(NOW-1), 묶음 상세의 다섯 가지.

설치: 버전 PR #100(머지 347de207) 에 서명 태그 `v0.1.4-rc.3`, release run 의 smoke 가 `ok tree: … (sangsoe 0.1.4-rc.3)`, pre-release. tap PR 39 가 `Formula/sangsoe-rc.rb` 를 rc.3 로 올렸다(`sangsoe land`, `merge_verdict`). `brew upgrade sangsoe-rc` → `sangsoe 0.1.4-rc.3`, `sangsoe install` → `approval waits — fingerprint ap1-a64c12da…`, `plugin approve --dry-run` 세 점검 ok, 내용 `20a5177e…` 는 풀어 놓은 릴리스 tarball 의 `orca plugin inspect` 와 같다. 오너가 approve, `sangsoe doctor` 종료 코드 0 과 `orca plugin: local.sangsoe 0.1.4-rc.3, running`. `brew test` 는 Homebrew Ruby 의 TLS 로 NOT VERIFIED.

고정물(새로, 셋): A #11 `s6r2/a` → `main`, B #12 `s6r2/b` → `s6r2/a`, C #13 `s6r2/c` → `s6r2/b`. 오케스트레이터 Run `run_5d2453dcb97e`(리드 항목 i020), 리드 Run `run_ce107f27a48e`(i021–i023, `lead: lead:s6r2`). 리드는 queue 라운드를 돌리지 않고 `🔁 rereview_item` 깨움만 기다렸다.

| # | 본 것 | 판정 |
|---|---|---|
| O3 | 오케스트레이터가 `worktreeId` 없이 `start_unit` → `started`, 읽은 worktree 는 smoke 저장소의 것 | PASS |
| 워커 | 워커 셋이 PR 이 열린 채 worker_done(succeeded), Task 셋 completed. rc.2 에서 본 gate 막힘은 다시 나지 않았다 | 관찰 |
| 패널 | A 머지 전 `sangsoe brief lead:s6r2`: 머리 `열린 4건·막힘 3`, 🚧 셋에 왜 행 셋(i021 자기 PR, i022 ← i021 · i023 ← i022 `stacked_on`), 크리티컬 패스 `i021 → i022 → i023` | PASS (🚧 마다 왜 행, C 가 B 를 기다림, 열린 N건) |
| 패널 | 브레드크럼 한 번, 범례 접힘: 패널이 html 이라 `orca plugin shot --act` 가 거부, 묶음 상세를 찍지 못했다 | NOT VERIFIED |
| NOW-3(b) | #11 land(`merge_verdict`), #12 retarget → `pr_base_changed`. land #12 `rereview_needed`(항목 없음). plugin 타이머의 queue 라운드는 돌았지만(17:57:42 `edge_removed`) `notified` 행이 없고 10분 동안 깨움 0. U82 의 queue 라운드는 `rereview items: made 0, refused 0, fenced 1`, 깨움 act 는 `send_failed`. #13 retarget 뒤에도 같다(18:15:42 라운드, `notified` 0) | FAIL (fenced 는 잡지만 깨움이 리드 Run 에 닿지 않는다) |
| 10 | 손 `sangsoe graph sync --run run_ce107f27a48e`(리드 세션, 깨움 대신) → `made #12 → i024`. land `rereview_needed … (re-review item i024)`, 왜 표 i022 ← i024 `blocks`. `behind_base` 뒤 main 을 합친 새 head 에 기록 → `merge_verdict`, 리드가 i024 를 닫았다 | PASS (손 sync 뒤) |
| NOW-1 | #13 `gh pr close` → `pr_closed`, `gh pr reopen` → `pr_reopened`. B 머지와 #13 retarget 뒤 손 sync → `made #13 → i025`. land `rereview_needed … (re-review item i025)`, 왜 표 i023 ← i025 `blocks`, 크리티컬 패스 `i025 → i023` | PASS (손 sync 뒤) |

깨움의 길: queue 라운드(`core/detect/queue/round.ts` 의 fenced 깨움) → `sendNotice` → `notify` → `orca orchestration send --to run:<리드 Run> --type status`, plugin worker 프로세스가 CLI 를 띄운다. 이 세션에서 같은 호출은 자기 Dispatch 의 `dispatch_run_mismatch` 로 거부된다. Dispatch 없는 호출은 이 실행에서 하지 못했다. 타이머의 act 결과는 거부 코드만 남고 로그 · `probe.report` 에 없어 Orca 의 오류 원문은 보이지 않는다. 응답이 사라진 경우는 `notified` 행을 남기므로, 행이 없다는 것은 Orca 가 두 번 다 거부로 답했다는 뜻이다. Orca host API 에는 orchestration 메시지를 보내는 메서드가 없고 `workspace:read` · `agent:read` 는 읽기만 덮는다.

닫기: #11 · #12 머지(`sangsoe land`), #13 닫음, 원격 `s6r2/*` 삭제, 열린 PR 0. 리드 Run 의 Task 다섯(재리뷰 항목 둘 포함) completed, 워커 셋 `released`, 리드 worker_done 뒤 `released`.

남은 것: NOW-3(b) 의 깨움 전송과 그 실패를 남기지 않는 act 보고는 다음 고침이 다룬다. 정식 0.1.4 는 그 고침의 rc 뒤로 미룬다.

### S6 세 번째 재실행 기록 (2026-11-12 JST, 설치본 0.1.4-rc.4)

결정 219–223 을 설치본에서 잰다: 리드 세션 자신의 hook 이 만드는 재리뷰 항목(NOW-3(b), 219), O3 회귀, 패널 (6)–(20) 과 상태 줄(219 · 220 · 222), `install --permissions`(221), `item retire`(223).

설치: 버전 PR #107(머지 5a70af24) 에 서명 태그 `v0.1.4-rc.4`, release run 의 smoke 가 `ok tree: … (sangsoe 0.1.4-rc.4)`, pre-release. tap PR 40 은 CodeRabbit 이 상태를 하나도 올리지 않아 `sangsoe land` 가 `checks_missing` 으로 거부했고, 오케스트레이터가 diff 와 asset sha256 을 확인하고 일반 머지했다(65d0a167). `brew upgrade sangsoe-rc` → `sangsoe 0.1.4-rc.4`, `sangsoe install` → `approval waits — fingerprint ap1-9d194835…`, `plugin approve --dry-run` 세 점검 ok, 내용 `75881722…`. 오너가 approve, `sangsoe doctor` 종료 코드 0 과 `orca plugin: local.sangsoe 0.1.4-rc.4, running`.

`install --permissions`: 터미널 없이 부르면 diff(allow 16줄 추가, 지우는 줄 없음)만 보이고 `no terminal to ask on; nothing written` 으로 끝난다. 그 diff 를 오케스트레이터에게 보냈고, 오너가 나중에 직접 돌렸다(백업 `settings.json.sangsoe-backup`). 뒤의 doctor 는 `permissions: 16 of 16`. `land allow` 행은 사라지지 않고 `permissions.allow 2` 로 남는다(이전 규칙과 새 규칙 둘).

고정물(새로, 둘): A #14 `s6r3/a` → `main`, B #15 `s6r3/b` → `s6r3/a`. 오케스트레이터 Run `run_a86f175dd77a`(리드 항목 i026), 리드 Run `run_60651478dbb8`(i027 · i028, `lead: lead:s6r3`). 리드는 queue 라운드도 `graph sync` 도 돌리지 않았다.

| # | 본 것 | 판정 |
|---|---|---|
| O3 | 오케스트레이터가 `worktreeId` 없이 `start_unit` → `started`, worktree 는 smoke 저장소의 것. 리드의 `run-current` 는 처음 null(오케스트레이터 Run 을 물려받지 않음)이었고, 리드가 만든 자기 Run `run_60651478dbb8` 뒤로는 그 Run | PASS |
| 워커 | 워커 둘이 PR 이 열린 채 worker_done(succeeded), Task 둘 completed | 관찰 |
| 패널 (6) | 게이트 없는 d001 이 버튼 없는 빨간 행 | PASS |
| 패널 표 · 카드 | 너비 720 은 열 역할로 나눈 표, 640 · 360 은 행마다 카드 하나 | PASS |
| 패널 현황 | 셋째 절이 `열린 항목 6`(묶음 넷의 행) | PASS |
| 묶음 상세 | `sangsoe brief lead:s6r3`: `열린 2건·막힘 2`, 크리티컬 패스 `i027 → i028`, 왜 행 둘(i027 자기 PR, i028 ← i027 `stacked_on`). `stacked_on` 은 PR 이 열리고 약 2분 뒤 queue 라운드가 만들었다 | PASS |
| 상태 줄 | `panel.brief` 의 status: `✨ SANGSOE \| 🚧 5 \| 결정 1 \| 🔄 1`, tone `danger`. 오너의 화면 캡처(rc.4, 10:01)에서 Orca 아래 막대의 같은 글이 빨간 tone 으로 보이고, 위 패널은 `열린 항목 6` 의 카드다 | PASS, VERIFIED by the owner's screen capture (rc.4) |
| 묶음 상세 화면 | `orca plugin shot --act` 는 html 패널이라 거부. 오너의 화면 캡처(rc.4, 10:03)에서 `lead:s6r3` 상세의 의존 그래프(i027 → `stacked_on`), 크리티컬 패스 i027 → i028, 스택 PR 체인 1층 #14 · 2층 #15, `왜 준비되지 않았나 2` 머리가 보인다 | VERIFIED by the owner's screen capture (rc.4) |
| NOW-3(b) | #14 머지(오케스트레이터의 일반 머지, 아래), #15 retarget 01:08:10Z(GitHub timeline) → `pr_base_changed` 01:08:56(타이머). 리드가 쉬는 11분 동안 항목 없음, 타이머 act 0 · `notified` 0(219 ③ ④ 그대로). 01:20:25 재리뷰 판정을 리드에게 보냄(219 의 깨움) → 01:20:27 리드 Run 에 `item_created` i029 `re-review jeongjaesoon/sangsoe-smoke#15` 와 `i029 → i028 blocks`. 리드의 손 동작 없음 | PASS |
| 10 | 리드가 #15 head 에 기록 → land dry-run 이 `rereview_needed` 를 내지 않는다. 머지 뒤 리드가 `task-update --status completed` 로 i029 를 닫았다 | PASS |
| retire | `sangsoe item retire` i017 · i018(`lead:s6r`) · i023(`lead:s6r2`) → `retired`. 현황 🚧 5 → 1, 두 묶음이 열린 묶음에서 빠졌다. S6r3 를 닫은 뒤 현황 `묶음 0 · 🚧 0`, 상태 줄 `🚧 0 \| 결정 1 \| 🔄 0` | PASS |

머지 길: smoke 저장소와 tap 에 CI 가 없고 CodeRabbit 이 이날 상태를 올리지 않아, #14 · #15 의 `sangsoe land` 가 `checks_missing` 으로 거부했다. 기록된 리뷰가 있는 head 를 오케스트레이터가 `--merge --match-head-commit` 으로 일반 머지했다(#14 46a996b7, #15 89df6d37).

재리뷰 항목은 스스로 닫히지 않는다. 결정 215 ③ 에서 그것은 Orca Task 하나이고, `land` 와 pr-monitor 는 그 상태를 읽지 않고 event 로 판정한다. 자기 PR 이 없어 pr-monitor 의 머지 뒤 닫기(결정 212)에도 걸리지 않고, 리뷰 기록으로 닫는 길도 없다. 설계가 뜻한 길은 리드가 그 항목에 워커를 띄우고 그 워커가 리뷰를 기록하고 `land` 를 다시 부른 뒤 worker_done 으로 닫는 것이다. 이번처럼 리드가 판정을 직접 기록하면(결정 111 · 162: 작성자는 자기 PR 의 판정을 기록하지 못해 리드에게 보낸다) 항목은 머지 뒤에도 🟢 `시작` 으로 남고, `orchestrate` skill 은 그것을 닫으라고 말하지 않는다. 분류: LATER. 잘못 머지되는 일은 없고 남는 것은 할 일 없는 🟢 행 하나다. 고칠 길은 기록된 판정이 그 항목을 닫게 하거나 skill 에 닫기 한 줄을 더하는 것이다.

작은 것(LATER): 넓은 표에서 묶음 이름이 토큰 안에서 줄바꿈된다(`lead:s6r` / `3`). i026 의 누가 칸이 터미널 handle 원문이다. 처음 찍은 720 샷이 빈 화면이었고 다시 찍으니 그려졌다. 리드가 대기 턴을 끝낼 때마다 HIGH stop 에스컬레이션이 났다(네 번). 리드의 guard hook 이 foreground `orca orchestration check --wait` 를 막는다.

닫기: #14 · #15 머지, 원격 `s6r3/*` 삭제, 열린 PR 0. 리드 Run 의 Task 셋(재리뷰 항목 포함) completed, 워커 둘 `released`, 리드 worker_done 뒤 `released`. `sangsoe doctor` 종료 코드 0, notice 둘(reaper-config, model-table) 말고 모두 ok.
