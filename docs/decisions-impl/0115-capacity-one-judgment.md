# 115. 부하 판정은 `judgeLoad` 하나이고, macOS 에서는 메모리를 재지 않는다

결정 83 의 "부하 판정 함수는 하나(압박 게이트·resource-monitor·capacity 공용)"를 `core/capacity/` 의 순수 함수 `judgeLoad(sample, thresholds)` 로 둔다. 측정(`sampleLoad`)과 판정을 나눠 시험은 표본만 넣는다. 문턱(경고·위험)은 이전 구현의 압박 판정 기본값을 옮겼다: load/CPU 1.3·2.0, 메모리 여유 20%·10%, 디스크 여유 50·20 GB. 대기열·라운드 같은 압박 게이트의 나머지는 U12·U15 몫이다.

`capacity({live, limit, level})` 는 `danger` 면 0, 아니면 `limit - live` 다. `runSlots(orca, run, limit)` 가 그 Run 의 살아 있는 워커(`worker-list`)를 세어 `startUnit` 에 넘긴다. Run 당 기본 한도는 MCP tool 의 4 이고 설정으로 옮기는 것은 뒤 유닛 몫이다.

macOS 의 `os.freemem` 은 되찾을 수 있는 캐시를 빼고 세어 멀쩡한 머신에서도 몇 %로 읽힌다. 그 값으로 판정하면 늘 `danger` 라 시작이 0 이 되므로, macOS 에서는 메모리 칸을 비운다(재지 않은 칸은 판정하지 않는다). 이전 구현은 `kern.memorystatus_level` 을 읽었다. 그 읽기를 더하는 것은 뒤로 미룬다.
