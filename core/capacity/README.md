<!-- layout: slot=④ layer=실행 tokens=free -->
# core/capacity — 부하 판정 함수 하나

결정 83 의 압박 규칙: 부하 판정 함수는 하나이고 압박 게이트(U12)·resource-monitor(U15)·REAPER·`capacity` 가 같은 함수를 부른다.

- `judgeLoad(sample, thresholds?)` — 순수 함수. 표본(5분 load·CPU 수·메모리 여유 %·디스크 여유 GB)을 `ok`·`warn`·`danger` 와 사유 문구로 바꾼다. 사유는 지표·값·넘은 문턱을 적고(`디스크 여유 8 GB ≤ 위험 10 GB`) 나쁜 것이 먼저다. 측정값이 없는 칸은 판정에서 빠진다. 문턱은 인자, 없으면 표본의 `thresholds`, 없으면 `DEFAULT_THRESHOLDS` 순이다.
- `sampleLoad(home?)` — 이 머신의 표본(Node `os`·`statfs`)과 그 home 의 문턱(`readThresholds`)을 읽는다. 판정과 측정을 나눠 시험은 표본만 넣는다.
- `readThresholds(home?)` — `~/.config/sangsoe/config.json` 의 선택 키 `capacity`(`load_per_cpu`·`mem_free_pct`·`disk_free_gb`, 각각 `[경고, 위험]`). 지표마다 덮어쓰고, 없거나 꼴이 틀린 칸은 기본값이다(결정 210).
- `capacity({ live, limit, level })` — 새 워커를 열 자리가 몇 개인지. `danger` 면 0, 아니면 `limit - live`(음수는 0).

기본 문턱은 `DEFAULT_THRESHOLDS`(경고·위험): load/CPU 1.3·2.0, 메모리 여유 20%·10%, 디스크 여유 20·10 GB.
