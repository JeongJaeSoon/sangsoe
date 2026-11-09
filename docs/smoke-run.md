# smoke 종단 실행 기록 (U23)

설계 §6 의 "종단 실행 한 번"이다. 오케스트레이터 → 리드 → 워커 → land → 닫기를 버리는 저장소 하나로 돌리고, 단위들이 가짜 Orca 로만 잰 길을 실제 Orca 에서 잰다. 항목마다 판정은 `PASS` · `FAIL` · `NOT VERIFIED`(이유) 셋 중 하나이고, 판정 줄은 `판정: <값>` 꼴이다(`test/e2e/smoke/smoke-run.test.ts` 가 센다). 인용한 출력의 홈 경로는 `~` 로 줄였다.

## 환경

- 설치본: (go smoke 뒤 `sangsoe --version` · `sangsoe doctor` 출력)
- 버리는 저장소: `JeongJaeSoon/sangsoe-smoke`
- 격리 설정(`claude --settings <scratch>/smoke-settings.json`):

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "" },
  "enabledPlugins": { "sangsoe@sangsoe": true, "agent-skills@jeongjaesoon": false, "agent-skills@inline": false }
}
```

이 Mac 의 agent-skills 는 `enabledPlugins` 가 아니라 사용자 설정의 `env.CLAUDE_CODE_PLUGIN_DIRS` 로 실린다(`claude plugin list` 에 `agent-skills@inline`). 그래서 격리는 그 env 를 비워야 한다. `--settings` 로 비우면 `claude plugin list` 에서 사라지고, 프로젝트 `.claude/settings.json` 으로는 사라지지 않았다.

## 1. 리드의 Run 과 start_unit 으로 워커 시작 (unit_lineage_complete)

판정: NOT VERIFIED (아직 실행 전)

## 2. raw_start_refused (`orca agent launch` 시도)

판정: NOT VERIFIED (아직 실행 전)

## 3. 실제 PR 에 sangsoe land, pr-monitor 실제 라운드

판정: NOT VERIFIED (아직 실행 전)

## 4. 실제 Orca 의 알림 (U29)

판정: NOT VERIFIED (아직 실행 전)

## 5. 실제 transcript 의 hook (U27 · U13)

판정: NOT VERIFIED (아직 실행 전)

## 6. queue 라운드 non-dry (U17)

판정: NOT VERIFIED (아직 실행 전)

## 7. 패널 · 상태 표시줄 · `sangsoe todo` 숫자, 추천대로 답 (U28)

판정: NOT VERIFIED (아직 실행 전)

## 8. MCP resource 서버 이름, Run 없는 패널 버튼 보내기

판정: NOT VERIFIED (아직 실행 전)

## 9. 쓰는 migrate import (scratch 사본만)

판정: NOT VERIFIED (아직 실행 전)

## 10. 닫기: worker_done → release → 카드 닫힘, REAPER 표시

판정: NOT VERIFIED (아직 실행 전)
