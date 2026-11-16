# brief 다섯 절 — 설계 (결정 320)

오너 요청(2026-11-16): 개발 완료 · 진행 중 · 다른 사람 대응 대기 · 내가 대응·검토할 것 · 앞으로 할 것을 표로 보이고, 그것을 brief 로 만들어 오른쪽 패널에 넣고, `/sangsoe:brief` 로 전체를, 절 이름을 붙여 절 하나를 본다. 뒤이은 말: 넷째 절에 오너가 아니라 에이전트가 할 일도 섞이니, 제목을 바꾸고 모든 절에 누가 할 것인지를 넣는다.

이 폴더는 구현 전의 설계와 시안이다. 코드는 바꾸지 않았다. 오너가 시안을 보고 고른 뒤에 구현 항목이 시작된다.

- `README.md` — 이 설계
- `brief.md` — 시안 (a): `/sangsoe:brief` 전체 출력
- `brief-action.md` — 시안 (b): `/sangsoe:brief:action`(= `/sangsoe:brief action`) 한 절 출력
- `progress.html` — 시안 (c): 패널 진행 상황 탭 정적 시안. `?theme=dark` 로 어두운 테마, `?w=360` 으로 좁은 패널을 본다

모든 시안의 데이터는 fixture 다(저장소 `acme/app` · `acme/api`, 티켓 `ACME-1`…, 리뷰어 `reviewer-a`…, 리드 `billing` · `login`). 세 시안은 같은 fixture 이고, (b) 는 (a) 의 한 절을 그대로 잘라 낸 것이다.

## 1. 절 다섯

| # | 절 | 키 | 담는 것 | 행이 빠지는 때 |
|---|---|---|---|---|
| 1 | 개발 완료 | `done` | 최근 `brief.done_days`(기본 7) 일 안에 ✅ 가 된 항목. 행마다 배포 단계(머지 · dev · prod)와 근거 | 기간이 지남, 항목이 거둬짐 |
| 2 | 진행 중 | `doing` | 지금 누군가 돌리고 있는 일: 살아 있는 워커, 검증 probe 를 기다리는 항목, CI 나 머지를 기다리는 PR | 워커가 끝나거나 멈춤(→ 4), 머지(→ 1) |
| 3 | 다른 사람 대응 대기 | `waiting` | sangsoe 밖의 사람이 움직여야 하는 일: 리뷰 의뢰를 받은 사람, 인프라, 다른 팀 | 리뷰 판정·코멘트(→ 2 또는 4), 막힘이 풀림 |
| 4 | 확인·대응 필요 | `action` | 그 사람이 움직이기 전에는 아무것도 진행되지 않는 일. 오너 행이 먼저 오고 표시된다 | 답·승인·기록 같은 관찰된 사실 |
| 5 | 앞으로 할 것 | `next` | 준비됨 · 선행 대기 · 조건(trigger) · 날짜 · 보류 | 시작됨(→ 2), 거둬짐, 증거상 끝남(→ 4 의 닫기 행) |
| (6) | 티켓 현황 | `tickets` | 선택(§12 의 선택 3). 기본으로는 그리지 않는다 | — |

옛 네 절과의 관계. 결정 필요 · 지금 오너가 할 일은 4 의 오너 행이 된다. 열린 항목은 상태에 따라 2 · 3 · 4 · 5 로 나뉜다. 보류는 5 가 되고, 완료 최근 N일은 1 이 된다. 묶음(리드) 머리 행은 다섯 절 보기에서 없어지고 `누가` 칸의 `lead:<이름>` 이 그 자리를 맡는다. 묶음 상세(`sangsoe brief <묶음>`, 2단계)와 항목 상세(3단계)는 그대로다.

**한 사실은 한 행이다.** 같은 항목이 두 절에 나오지 않는다. 결정에 막힌 항목은 결정 행 하나로 나오고, 그 항목은 결정 행의 `풀리는 일` 에 적힌다. 같은 PR 을 가리키는 오너의 `!` 줄 여럿은 가장 새 줄 하나가 된다.

## 2. 칸

모든 절이 같은 다섯 칸을 쓴다. 렌더러는 하나이고, 패널은 칸 이름으로 거르지 않고 절 키로 거른다.

| 칸 | 폭(셀) | 내용 |
|---|---|---|
| 누가 | 14 | `오너` · `오케스트레이터` · `lead:<이름>` · `worker` · 사람 이름(다른 사람). 오너는 굵게 |
| 무엇 | 22 | `iNNN 제목` 또는 `dNNN 질문`. 항목 상세로 가는 id 가 맨 앞이다. 항목이 없는 R20 행만 PR 라벨이 맨 앞이다 |
| 링크 | 12 | PR(`acme/app#12`) → 티켓(`ACME-1`) → 결정(`d041`) 순서로 첫째 하나. 없으면 `—`. PR 라벨은 `prLabel` 그대로 |
| 상태·다음 | 22 | 절마다 다르다(§3). 개발 완료에서는 배포 단계(R2)와, 근거가 모자랄 때만 그 표시(R3) |
| 경과 | 4 | 그 상태가 된 지, 곧 누구를 언제부터 기다리는지. `since()` 의 꼴 그대로다(2시간 아래는 `75m`, 48시간 아래는 `30h`, 그 위는 `2d`). 개발 완료에서는 닫힌 지 |

칸 합은 74 셀이고, 구분자를 더하면 한 줄이 90 셀이다. 결정 89 의 78 셀보다 넓다. 누가 칸이 새로 들었고, `오케스트레이터`(14 셀)가 잘리면 칸이 뜻을 잃기 때문이다(§12 의 선택 5). 칸 폭으로 자르는 규칙은 그대로다(`width.ts` `fit`). 시안 (a) 는 그 함수로 잘랐고, 가장 넓은 표가 89 셀이다.

**잘린 칸의 원문(결함 5).** 확인·대응 필요 표 아래에 결정과 오너 행의 원문을 목록으로 한 번 더 적는다: `- d041 질문 전문 — 추천: 추천 전문 · 선택지: a / b / c`. 이 목록은 자르지 않는다. 그래서 상세를 열지 않아도 질문과 추천을 다 읽는다. 패널도 같은 목록을 같은 자리에 둔다. 넓은 패널의 칸은 결정 225 (10) 대로 한 줄에서 말줄임하고 `title` 에 원문을 싣는다. 좁은 패널(720px 아래)에서는 결정 220 · 222 의 카드 꼴로 접는다. 카드 머리는 `누가 · id · 제목` 이고, 메타 줄이 링크 · 상태·다음 · 경과다.

## 3. 행의 출처와 절 — 대응표

brief 는 store 의 event 와 Orca 스냅샷 하나만 읽는다(결정 12 · 89, `BriefInput`). 아래 "출처" 는 그 event 를 누가 쓰는지다. 오른쪽 넷은 그 행이 어느 절에, 누구 이름으로, 무엇을 다음으로, 언제부터 나오는지다. 상태·다음 칸의 글은 시안에 찍히는 글 그대로다. "리드" 는 `lead:<이름>` 이고, 리드가 없는 항목이면 `오케스트레이터` 다.

**먼저 맞는 규칙이 이긴다.** 한 사실에 규칙 여럿이 맞으면 이 차례로 본다: R26 → R25 → R15–R21 → R24 → R7 · R7′ → R9 → R14 → R8 → R10–R13 → R4–R6 → R22–R23 → R1. 그래서 살아 있는 워커의 PR 에 변경 요청이 오면 R4 가 아니라 R9 이고, 완료 Task 의 열린 PR(`itemFacts` 가 `waitsOn` 을 reviewer 로 읽는다)은 R6–R9 가 R10 보다 먼저 본다.

| # | 사실(출처) | 조건 | 절 | 누가 | 상태·다음 | 언제부터 |
|---|---|---|---|---|---|---|
| R1 | 항목 ✅ (`item_transition` → done, Orca `completed`) | `closedAt` 이 기간 안 | 개발 완료 | 리드 | 배포 단계(R2), 근거가 모자라면 그 표시(R3) | 닫힌 때 |
| R2 | `pr_merged` (pr-monitor) · `stage_recorded{pr, stage}` (stage_record tool) | R1 행의 PR | (R1 의 칸) | — | 닿은 마지막 단계에 ✓, 흐름에 남은 단계가 있으면 그것에 `대기`: `머지 ✓` · `dev ✓ · prod 대기` · `prod ✓` | — |
| R3 | `evidence` · `review_verdict` | R1 행 | (R1 의 칸) | — | 근거가 있으면 표시 없음. 없으면 `🔍 근거 부족`, 리뷰만 있으면 `👀 리뷰만` | — |
| R4 | 항목 `in_progress` (Orca `dispatched`) | 🚨 가 없거나, 있어도 워커가 살아 있음 | 진행 중 | worker(Orca assignee) | 워커의 마지막 보고 · `🚨 CI 수정` 같은 `ALARM_NEXT` 의 글 | 상태가 된 때 |
| R5 | 항목 `pending_verify` (결정 181) | — | 진행 중 | 리드 | `검증 probe 대기` | 상태가 된 때 |
| R6 | 완료 Task 의 열린 PR (`holdOf` by=pr, open) | R7 · R8 · R9 · R14 가 아님 | 진행 중 | 리드 | `CI·머지 대기` | 상태가 된 때 |
| R7 | 같은 PR 의 `land_requested{reason: merge_on_approval, waits: owner}` (land) | 같은 head 에 `owner_approval` 이 아직 없음 | 확인·대응 필요 | **오너** | `승인 줄 치기` (원문 목록에 그 줄 전문) | `land_requested` |
| R7′ | 같은 PR 의 `land_requested{reason: merge_on_approval}`, `waits` 가 owner 가 아님 | GitHub 승인 전 | 다른 사람 대응 대기 | 의뢰받은 리뷰어(R8 에서), 없으면 `리뷰어` | `승인 대기` | `land_requested` |
| R8 | 같은 PR 의 `review_ask_sent{reviewer}` (review_ask_record tool) · `pr_review_requested{reviewer}` (pr-monitor) | 그 뒤 그 리뷰어의 `review_verdict` · `pr_changes_requested` · `review_commented` 가 없고, `pr_ready_to_merge` · `pr_merged` 도 없음 | 다른 사람 대응 대기 | 그 리뷰어. `reviewer` 가 없는 팀 의뢰면 `리뷰어` | `리뷰 대기`, 독촉(`reminder`)이 있으면 `리뷰 대기 · 독촉 N회` | 첫 의뢰 |
| R9 | 같은 PR 의 `pr_changes_requested` · `review_commented` (pr-monitor) | 결정 198 · 201 의 🚨 규칙 그대로: 항목이 움직이거나 작성자의 `review_replied` 가 더 새로우면 끝 | 확인·대응 필요 | 살아 있는 worker, 없으면 리드 | `리뷰 변경 요청 반영` · `리뷰 코멘트에 답` | 그 event |
| R10 | 항목 `blocked`, `waits_on` = reviewer · infra | — | 다른 사람 대응 대기 | 리뷰어 이름(R8 에서), 없으면 `리뷰어` · `인프라` | 리드가 적은 이유 | 상태가 된 때 |
| R11 | 항목 `blocked`, `waits_on` = owner, 또는 결정 게이트에 막힘 | — | (R15 의 결정 행으로만) | — | — | — |
| R12 | 항목 `blocked`, `waits_on` = lead · worker, 오너 것이 아닌 게이트, 또는 `waits_on` 이 없는 Orca 막힘 | — | 확인·대응 필요 | 리드 · worker | 리드가 적은 이유, 없으면 `Orca 에서 막힘` | 상태가 된 때 |
| R13 | 항목 `pr_closed` · `unknown` (결정 178) | — | 확인·대응 필요 | 리드(`pr_closed`) · 오케스트레이터(`unknown`) | `닫힘: 다시 열기·거두기` · `PR 상태 못 읽음` | 상태가 된 때 |
| R14 | 🚨 `worker_dead` · `refusal_report` · `land_failed` · `loop_detected` · `decision_untracked`, 그리고 완료 Task 의 열린 PR 에 걸린 `ci_failed` (`PR_ALARMS`) | 살아 있는 워커가 없음(있으면 R4 의 🚨) | 확인·대응 필요 | 리드. `worker_dead:auth` 는 **오너** | `ALARM_NEXT` 의 글(`🚨 CI 수정`, `🚨 재로그인` …) | 그 event |
| R15 | 열린 결정 (`decision_opened` + Orca 게이트) | R16 이 아님 | 확인·대응 필요 | **오너** | `추천: <첫 선택지>` (질문 · 선택지 · 풀리는 일은 원문 목록) | 열린 때 |
| R16 | 같은 결정, 열린 뒤 오너의 `owner_action.summary` 가 그 `dNNN` 으로 **시작함**(`d040 …`, `d040: …`) | `decision_answered` 없음 | 확인·대응 필요 | 오케스트레이터 | `대화로 답함 → 기록` | 그 `owner_action` |
| R17 | 답했지만 전달 안 된 결정 (`undelivered`) | — | 확인·대응 필요 | 오케스트레이터 | `답 다시 보내기` | 답한 때 |
| R18 | 오너 항목 🟢 (`exec_by: owner`, 결정 91) · 거부된 시작(`escalation{to: owner}`) | 검증이 아직 참이 아님 | 확인·대응 필요 | **오너** | `cmd_hint` 또는 그 이유 | 상태가 된 때 |
| R19 | `waiting_human` (풀리지 않고 `escalation_stale`) | — | 확인·대응 필요 | **오너** | `터미널 입력` · 발췌 | 그 event |
| R20 | `owner_act_unlinked` (오너가 친 `!` 줄) | §4 결함 1 규칙으로 남은 것만 | 확인·대응 필요 | 오케스트레이터 | `오너 직접 친 줄: 연결` | 그 event |
| R21 | `pr_review_requested{reviewer: <오너 login>}` (pr-monitor 가 읽는 PR 만: `watch.repos` · `watch.authors` · `linked_only` 를 지난 것) | 그 뒤 오너의 리뷰가 없음 | 확인·대응 필요 | **오너** | `리뷰 요청받음` | 그 event |
| R22 | 항목 `ready` (오너 항목 아님) · `todo_due` | — | 앞으로 할 것 | 리드 | `시작` · `때가 됨` | 상태가 된 때 |
| R23 | 항목 `planned` (선행 · trigger · hold, 결정 279) · `on_hold` | R24 가 아님 | 앞으로 할 것 | 리드 | `i303 뒤` · `조건: <trigger>` · `⏸️ <review_trigger>` | 상태가 된 때 |
| R24 | ⏸️ 항목의 PR 에 `pr_merged`(흐름에 배포 단계가 있으면 마지막 단계의 `stage_recorded` 까지), 또는 그 항목의 verify 가 참 | — | 확인·대응 필요 | 리드 | `증거상 끝남 → 닫기` | 그 증거 |
| R25 | `run_stalled{coordinator}` (결정 309) | 해소되지 않음, 24h 안 | (절 밖 줄) | — | — | — |
| R26 | 거둔 항목(`item_retired`) · `cancelled` · `smoke` 항목 · `item_created` 없는 Task | — | 어디에도 없음, 세지 않음 | — | — | — |

누가의 출처. `오너` 는 위에서 굵게 적은 행이다. `lead:<이름>` 은 `item_extra_set.lead` 다. 리드가 없는 항목(지금의 "그 외" 묶음)과 sangsoe 자신이 처리할 행(R13 의 `unknown` · R16 · R17 · R20)은 `오케스트레이터` 다. `worker` 는 Orca 가 Task 에 단 assignee 다. 다른 사람은 R8 의 `reviewer` 와 `waits_on` 의 낱말이다.

**새로 필요한 칸 둘.** (가) R7 을 R7′ 과 가르려면 `land_requested` 가 무엇을 기다리는지 적어야 한다. 지금 `merge_on_approval` 은 두 경우를 한 꼴로 쓴다: `verdict_merge_repos` 밖의 PR 은 아무 GitHub 승인을 기다리고, 안의 V3 · 보호 경로 PR 만 오너의 승인 줄을 기다린다(`core/land/land.ts` 의 `waitApproval`). 그래서 `land_requested` 에 `waits: "owner" | "approval"` 을 더한다. 그 행만으로는 brief 가 설정과 등급을 알 수 없다. (나) §4 결함 4 의 `item_extra_set.smoke`. 그 밖의 누가 · 절은 이미 있는 event 와 칸으로 정해진다.

**알려진 빈 곳.** GitHub 승인은 리뷰어마다 event 가 없다(pr-monitor 는 `merge_on_approval` PR 에만 `pr_ready_to_merge` 를 쓴다). 그래서 승인됐지만 아직 초록이 아닌 PR 은 R8 에서 `리뷰 대기` 로 남는다. 승인 event 를 더하는 것은 Pull Request 탭 설계가 다룬다(LATER, trigger 는 그 설계의 시작).

## 4. 관찰한 결함 여덟을 설계로 접기

| # | 결함 | 이 설계의 규칙 |
|---|---|---|
| 1 | 성공한 오너 `!` 줄이 열린 행으로 남는다. 재시도로 같은 PR 이 셋이다 | 그 줄이 가리키는 PR 에 그 줄보다 뒤의 `pr_merged` 나 `pr_closed` 가 있으면 행이 빠진다. 같은 PR 의 줄 여럿은 가장 새 것 하나다. 남는 것은 R20 이고, 누가는 오케스트레이터다. `!` 줄을 항목에 잇는 쪽(`core/owner/link.ts`)을 고치는 것은 별 항목이다. brief 는 보이는 규칙만 갖는다 |
| 2 | 대화로 답한 결정이 열린 채 남는다 | R16: 오너의 말이 `dNNN` 으로 시작하면 그 행의 누가가 오케스트레이터로 바뀌고 `decision_answer 기록` 을 다음으로 보인다. brief 는 답을 지어내지 않는다. 같은 턴에 `decision_answer` 를 부르게 하는 것은 orchestrate skill 의 별 항목(D11)이다 |
| 3 | 일이 끝난 보류 항목이 ⏸️ 로 남는다 | R24: 증거가 끝났다고 말하면 앞으로 할 것에서 빠지고 확인·대응 필요에 닫기 행으로 나온다. 닫는 것은 그 행의 누가다. sangsoe 는 이것을 닫지 않는다(자동으로 닫는 것은 pr-monitor 의 머지 확인 하나다: 결정 76 ⑥ · 84 ①) |
| 4 | 시험 probe 항목이 오너 brief 에 🟢 로 나온다 | `item_extra_set.smoke: true`(새 칸, `item_create` 와 `sangsoe item set` 의 `smoke` 입력)인 항목은 R26 이다. 표에도 수에도 없다. "probe" 는 이미 verify probe(결정 181)의 이름이라 칸 이름으로 쓰지 않는다. 이미 만든 시험 항목은 `sangsoe item set <iNNN> --smoke` 로 표시한다 |
| 5 | 칸이 잘려 결정과 항목을 못 읽는다 | §2 의 원문 목록. 패널은 같은 목록과 칸의 `title` |
| 6 | 빠진 절(다른 사람 대응 대기, 오늘 개발 완료, 단계별 배포 중) | 절 3(R7′ · R8 · R10), 절 1(R1 · R2). 배포 중인 PR 은 개발 완료 행의 단계 칸에서 `dev ✓ · prod 대기` 로 보인다 |
| 7 | 머리의 "🔍 근거 부족 N · 👀 리뷰만 있음 N" 이 어느 항목인지 없다 | 머리에서 뺀다. 개발 완료의 행이 근거가 모자랄 때 그 표시를 단다(R3). 절 제목에 `🔍 1` 처럼 수를 달아 그 수의 행이 바로 아래 있게 한다 |
| 8 | 묶음 이름이 내부용이다(`<프로그램> P2`, `그 외 P2`) | 다섯 절 보기에는 묶음 머리 행이 없다. 저장소는 링크 칸의 PR 라벨(`acme/app#12`)이, 프로그램은 누가 칸의 `lead:<이름>` 이 보인다. 우선순위는 같은 절 안의 정렬 열쇠로만 쓴다 |

## 5. 정렬과 머리 줄

절 안의 정렬은 셋이다. (1) 누가가 오너인 행, (2) 🚨 가 있는 행, (3) 경과가 긴 순. 개발 완료만 새로 닫힌 것이 위다(지금의 완료 목록과 같다).

머리 줄: `현황 · 11/16 21:00 · 오너 차례 4 · 완료 3 · 진행 3 · 대기 2 · 확인·대응 9 · 앞으로 4`. `오너 차례` 는 확인·대응 필요 가운데 누가가 오너인 행의 수다. 셈은 그 하나다.

- **오늘의 "내가 할 일 N" 과 다른 점.** 지금 `ownerTodoFrom` 은 결정 · 오너 항목 · 터미널 입력 · 전달 안 된 답(`undelivered_answer`)을 센다(`core/owner/todo.ts`). `오너 차례` 는 그 가운데 전달 안 된 답을 빼고(R17, 다시 보내는 것은 오케스트레이터다) R7 · R21 · R14 의 `worker_dead:auth` 를 더한다. R16 으로 넘어간 결정도 빠진다
- `sangsoe todo` 는 확인·대응 필요에서 누가가 오너인 행만 그리고, 머리 수는 `오너 차례` 다
- 확인·대응 필요의 절 제목은 `확인·대응 필요 9 (오너 4)` 다
- **상태 표시줄 B**(결정 92 ⑤ · 170 · 219 · 309 ②). 지금은 `🚧 막힌 것 · 결정 N · 🔄 진행 중 · 🚨 N · ♻️` 이다(`core/brief/panel.ts` `statusBarItem`). 바꾼 뒤는 `오너 N · 확인 M · 🔄 K · 🚨 N · ♻️` 이다. `오너` 는 `오너 차례`, `확인` 은 확인·대응 필요 전체, `🔄` 는 진행 중 절의 수다. `🚨 N`(결정 309 ②)과 `♻️`(restart_due)는 그대로다. 위험 톤은 `오너` 가 0 이 아니거나 🚨 가 있을 때다. `🚧` 와 `결정` 항목은 없어진다. 막힌 것은 확인·대응 필요와 대기로 나뉘었고, 결정은 `오너` 에 들었다. 누르면 진행 상황 탭이 `오너` 칩을 켠 채로 열린다

꼬리 줄: `상세: sangsoe brief <절>(done · doing · waiting · action · next) · sangsoe brief <묶음>`. PR 상태가 얼마나 새로운지는 따로 적지 않는다. pr-monitor 는 바뀐 것이 있을 때만 행을 쓰고 라운드마다 남기는 event 가 없어서, brief 의 입력(event 와 스냅샷)만으로는 마지막으로 읽은 때를 알 수 없다. 예외 하나: 가장 새 `rate_limited{kind: github}` 의 `reset_at` 이 아직 오지 않았으면 꼬리 줄 앞에 `⚠️ GitHub 한도: PR 상태가 <감지 시각> 뒤로 멈춤, <풀리는 시각> 에 풀림` 을 단다. 라운드 시각을 보이고 싶으면 pr-monitor 가 라운드마다 행을 하나 써야 한다(LATER, trigger 는 오너가 PR 상태가 낡았다고 짚을 때).

## 6. GitHub 와 rate limit

brief 는 그리는 동안 GitHub 를 부르지 않는다. 지금 `core/brief` 에서 GitHub 를 읽는 곳은 resource `ready` 의 `overlap.ts` 하나이고(결정 252), 다섯 절은 그것도 쓰지 않는다. 그래서 brief · 패널 · 상태 표시줄을 몇 번 열어도 GitHub 한도는 줄지 않는다.

| GitHub 사실 | 공급하는 곳 | 낡았을 때 보이는 것 |
|---|---|---|
| 열림 · 머지 · 닫힘 | pr-monitor 라운드(`watch.repos` 마다 열린 목록 하나 + 닫힌 목록 하나, ETag) | 마지막으로 쓴 행 그대로. 한도에 걸렸으면 꼬리 줄의 ⚠️ |
| 리뷰 의뢰 · 변경 요청 · 코멘트 · 답글 | 같은 라운드의 리뷰 목록(`REVIEW_TYPES`, ETag) | 같음 |
| CI | 같은 라운드의 push CI | 같음 |
| dev · prod 배포 | GitHub 가 아니라 `stage_record` tool | 기록이 없으면 단계 칸이 `머지 ✓` 에서 멈춘다 |
| `watch.repos` 밖에서 오너에게 온 리뷰 요청 | 지금은 없음 | 나오지 않는다. LATER: 라운드마다 검색 한 번(`review-requested:<오너>`, ETag). trigger 는 Pull Request 탭 설계의 시작 |

`budgetLevel` 이 `essential` 이면 pr-monitor 는 열린 목록을 건너뛴다(`round.ts`). 그때 진행 중 · 대기의 PR 행은 마지막으로 읽은 상태로 남는다. `essential` 은 event 를 남기지 않으므로 brief 는 그것을 말하지 못한다(한도가 0 이 된 `rate_limited` 만 말한다).

## 7. 세지 않는 것과 거두는 길

- **`item_created` 가 없는 Task.** `itemFacts` 는 이미 이런 Task 를 건너뛰고(`item_status.ts`), 준비됨 읽기는 결정 314 로 같은 규칙이 되었다. 그래서 다섯 절과 모든 수에서 이미 빠져 있다. 그대로 둔다
- **시험 항목.** `smoke: true` 인 항목은 표에도 수에도 없다. 그 항목의 상세(`sangsoe brief <묶음> <iNNN>`)는 열린다. 표시만으로 빠지므로 거둘 필요가 없다
- **거두는 길은 바꾸지 않는다.** `item_retire` 는 결정 223 그대로 머지 없이 PR 이 닫힌 완료 항목만 받고 Orca 에 쓰지 않는다. `item_created` 가 없는 옛 Task 는 이미 어느 수에도 없으므로 brief 쪽에서 할 일이 없다. Orca 의 목록에서 치우는 것은 그 Run 을 쥔 세션이 Orca 의 `task-update` 로 한다(결정 219 의 호출자 규칙). sangsoe 가 그 일을 맡을지는 이 설계 밖이다(LATER, trigger 는 오너가 Orca 의 목록에서 옛 Task 를 치우자고 할 때)

## 8. 명령 꼴

**근거.** Claude Code 문서 "Add components to a plugin"(`https://code.claude.com/docs/en/plugins/components.md`, 2026-11-16 읽음)의 Commands 절이 이렇게 말한다: "Save a command at `commands/<file>.md` and it becomes `/<plugin>:<file>`. A subdirectory adds a segment, so `commands/db/migrate.md` is `/my-plugin:db:migrate`." 같은 문서는 skill 이 `/<plugin>:<directory>` 하나뿐이고, frontmatter `name` 은 마지막 마디만 바꾼다고 말한다. 같은 문서는 commands 를 "older format" 이라 부르고, 새 일은 skill 로 쓰고 `commands/` 는 옮겨 오는 파일에 두라고 권한다. 콜론 꼴은 그 권고를 거슬러 새 command 파일 다섯을 더하는 값을 치른다. 그래도 지원은 문서에 적혀 있다. 인자는 skill 과 command 가 같다: `$ARGUMENTS` 가 이름 뒤의 글 전부다(`skills.md`). sangsoe 의 `plugin.json` 은 `commands` 키를 두지 않으므로 기본 `commands/` 폴더를 읽는다.

그래서 두 꼴 다 지을 수 있다.

- **인자 꼴 `/sangsoe:brief <절>`.** 지금의 `skills/brief/SKILL.md` 가 이미 `` !`sangsoe brief $ARGUMENTS` `` 를 부르므로, CLI 가 절 키를 받으면 따로 고칠 것이 없다. frontmatter 에 `argument-hint: "[done|doing|waiting|action|next]"` 를 더해 자동 완성에 보인다
- **콜론 꼴 `/sangsoe:brief:<절>`.** `claude-plugin/commands/brief/<절>.md` 다섯 파일이고, 각각 `` !`sangsoe brief <절>` `` 와 skill 과 같은 "고치지 않고 그대로 보인다" 지시를 갖는다. `/sangsoe:brief:` 를 치면 다섯이 자동 완성에 나온다

**재지 못한 것.** skill `sangsoe:brief` 와 command `sangsoe:brief:*` 가 한 plugin 에 함께 로드되는지는 재지 않았다. 워커는 세션을 띄우지 않고, 띄우면 hook 이 store 에 행을 쓴다. 콜론 꼴을 고르면 그 구현 PR 의 첫 걸음이 이것을 재는 일이다(설치본에서 `/sangsoe:brief:` 자동 완성과 실행 한 번).

**CLI.** `sangsoe brief [<절> | <묶음> [<iNNN>]]`. 첫 위치 인자가 절 키이면 절 하나, 아니면 지금처럼 묶음이다. 절 키가 이긴다. 리드 이름은 `start_unit` · `item_create` · `sangsoe item set --lead` · migrate 가 모두 정하므로 입구마다 막지 않는다. 대신 절 키와 같은 이름의 묶음은 `sangsoe brief --group <이름>` 으로 연다. `--done` 은 2단계(묶음 상세)에만 남는다. 1단계의 완료 목록은 `done` 절이 대신한다. resource `brief` 는 다섯 절 전부를 주고, 절마다의 resource 는 두지 않는다(오케스트레이터는 전체를 읽고, 절 하나는 오너의 명령이다).

## 9. 한 원본

`buildBrief` 하나가 `Overview.sections`(키 다섯 → `Table`, 행마다 `who`)를 채운다. 수(`오너 차례` 와 절마다의 수)도 같은 훑기에서 센다(결정 89 · 128). 그 위에 셋이 있다.

- `renderMarkdown(model, { section })` — 채팅 · `sangsoe brief` · resource `brief`. `section` 이 있으면 그 절과 머리 줄 · 꼬리 줄만 그린다. 그래서 시안 (b) 는 (a) 의 한 조각이다
- 패널의 진행 상황 탭 — 같은 `Overview` 를 HTML 로 그린다. 거르기는 화면 쪽에서 `data-sec` · `data-who` 속성으로 한다. 다시 세지 않는다
- 상태 표시줄 B · `sangsoe todo` — `오너 차례` 와 절마다의 수를 읽는다(§5)

## 10. 패널 진행 상황 탭

탭 셋은 `전체 / Pull Request / 진행 상황` 이다(패널 설계 칸 모음의 순서).

- **진행 상황**: 다섯 절을 위에서 차례로. 절마다 `<details>` 로 접고, 처음에는 모두 펼친다. 접은 상태는 패널을 다시 그려도 남는다(지금 탭 상태를 남기는 것과 같은 자리)
- **거르기**: 탭 머리 아래 한 줄. 누가 칩(`전체 · 오너 · 에이전트 · 다른 사람`)과 절 칩(다섯). 칩은 그 절이나 행을 숨길 뿐 수를 바꾸지 않는다. 탭 배지는 `오너 차례`
- **run_stalled 줄(결정 309)**: 진행 상황 탭 맨 위, 거르기 줄 위. 절이 아니라서 거르기와 접기에 숨지 않는다. 전체 탭에도 같은 자리에 같은 줄이 있다. 결정 309 ⑤ 가 LATER 로 남긴 "패널 본문의 줄" 이 이것이다
- **오늘의 탭.** `할 일` 탭은 없어진다. 진행 상황에서 `오너` 칩을 누른 보기가 그것이다. 상태 표시줄 B 를 누르면 그 보기로 열린다. `열린 항목` 표(묶음 머리 행과 그 아래 항목)는 `전체` 탭이 계속 그린다. 묶음 상세로 들어가는 길이 거기 있다
- **Pull Request 탭**: 이 설계 밖이다. 자리만 잡는다

## 11. 구현 항목 나누기(PR 단위)

같은 파일을 만지는 것끼리 차례를 둔다.

| 순서 | PR | 파일 | 앞선 것 |
|---|---|---|---|
| 1 | 새 칸 둘 | `core/contract/events/item_extra_set.ts`(`smoke`), `claude-plugin/mcp/tools/item_create.ts`, `cli/commands/item-new.ts` · `item-set.ts`, `core/contract/events/land_requested.ts`(`waits`)와 그것을 쓰는 `core/land/land.ts` | — |
| 2 | 다섯 절 모델과 글 | `core/brief/sections.ts`(새 파일, §3 의 대응표), `core/brief/build.ts`, `types.ts`, `render.ts`, `index.ts`, 골든 fixture | 1(두 칸을 읽는다) |
| 3 | 명령 | `cli/commands/brief.ts`(절 키 · `--group`), `cli/commands/todo.ts`, `claude-plugin/skills/brief/SKILL.md`, `claude-plugin/commands/brief/*.md`(콜론 꼴을 고르면), `claude-plugin/skills/todo/SKILL.md` | 2 |
| 4 | 패널 진행 상황 탭 | `orca-plugin/panel/view.ts`, `style.ts`, `index.ts`, `core/brief/panel.ts`(상태 표시줄 B 의 수) | 2 |
| 5 | 글 맞추기 | `docs/design.html` §3, `docs/glossary.md`, `docs/design-vs-code.md` | 2–4(각 PR 이 제 행을 고치고, 남은 것만) |

결함 1 의 `!` 줄 잇기(`core/owner/link.ts`)와 결함 2 의 orchestrate skill 규칙(D11)은 이 목록 밖의 별 항목이다. 2 는 그것 없이도 R16 으로 보인다.

## 12. 오너가 고를 것

1. **명령 꼴.** (가) 둘 다: `/sangsoe:brief <절>` 과 `/sangsoe:brief:<절>` — 추천. 오너가 예로 든 꼴이 콜론 꼴이고 문서가 지원한다. 인자 꼴은 지금 skill 이 이미 넘기므로 공짜다. 값은 문서가 옛 꼴이라 부르는 command 파일 다섯과, 설치본에서 한 번 재는 일이다(§8). (나) 인자 꼴만: 파일이 하나지만 `/sangsoe:brief:` 자동 완성이 없다. (다) 콜론 꼴만: 인자 꼴을 막을 길이 없어(skill 이 `$ARGUMENTS` 를 넘긴다) 사실상 (가) 와 같다
2. **절 키 이름.** (가) `done · doing · waiting · action · next` — 추천. 넷째 절이 오너만의 것이 아니게 되었으므로 `mine` 이 아니다. (나) `done · doing · waiting · mine · next`(앞선 메모의 이름). (다) 한글 `완료 · 진행 · 대기 · 확인 · 다음`. 치기는 쉽지 않고 자동 완성이 대신한다
3. **티켓 현황 절.** (가) 지금은 짓지 않는다 — 추천. store 에 티켓 상태가 없고(항목의 `links` 글뿐), 티켓 시스템을 읽으면 새 외부 의존이 생긴다. 링크 칸이 티켓 키를 보이므로 행마다의 티켓은 이미 보인다. LATER 이고, trigger 는 오너가 티켓별로 묶어 보자고 다시 말할 때다. (나) `tickets` 절을 `links` 에서만 짓는다: 티켓마다 한 행, 그 티켓의 항목·PR 과 그 상태
4. **패널 첫 탭.** (가) `진행 상황` 을 처음 여는 탭으로 한다 — 추천. 오너가 이번에 보자고 한 표다. (나) 지금처럼 `전체`
5. **채팅 표의 폭.** (가) 다섯 절 표만 90 셀 — 추천. 누가 칸의 `오케스트레이터` 와 `lead:<이름>` 이 잘리지 않는다. (나) 78 셀을 지키고 누가를 줄여 쓴다(`오케`, 리드는 이름만). 줄인 말을 따로 익혀야 한다
