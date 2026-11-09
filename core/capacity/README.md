<!-- layout: slot=④ layer=실행 tokens=free -->
# core/capacity — 부하 판정 함수 하나

결정 83 의 압박 규칙: 부하 판정 함수는 하나이고 압박 게이트(U12)·resource-monitor(U15)·REAPER·`capacity` 가 같은 함수를 부른다.

- `judgeLoad(sample, thresholds?)` — 순수 함수. 표본(5분 load·CPU 수·메모리 여유 %·디스크 여유 GB)을 `ok`·`warn`·`danger` 와 사유 문구로 바꾼다. 측정값이 없는 칸은 판정에서 빠진다.
- `sampleLoad(home?)` — 이 머신의 표본을 읽는다(Node `os`·`statfs`). 판정과 측정을 나눠 시험은 표본만 넣는다.
- `capacity({ live, limit, level })` — 새 워커를 열 자리가 몇 개인지. `danger` 면 0, 아니면 `limit - live`(음수는 0).

기본 문턱은 `DEFAULT_THRESHOLDS`(경고·위험): load/CPU 1.3·2.0, 메모리 여유 20%·10%, 디스크 여유 50·20 GB.
