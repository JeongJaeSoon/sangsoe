# 132. plugin worker 는 코어를 실행 중에 한 파일(`core-link.ts`)로 찾아 import 한다

설계는 "plugin worker 는 코어를 직접 import 한다"(결정 75 나)이고, U3 의 시험은 "plugin 코드는 폴더 밖을 import 하지 않는다"(승인과 내용 해시가 `orca-plugin/` 만 덮는다)다. 둘을 함께 지키려고 정적 import 는 폴더 안에 두고, 코어는 `orca-plugin/core-link.ts` 한 파일이 실행 중에 찾는다.

- **찾는 순서.** 폴더 옆의 `../dist/core/index.js`(브루 트리: `libexec/orca-plugin` 옆에 `libexec/dist`) → `../core/index.ts`(소스 체크아웃, worker 의 Node 가 타입을 지운다. T1 에서 확인). 둘 다 없거나 import 가 실패하면 worker 는 monitor 없이 돈다: `probe.report` 의 `monitors.state` 에 이유가 남고 로그 한 줄을 쓴다. 다른 길로 대신 돌리지 않는다.
- **시험.** `test/orca-plugin.test.ts` 가 폴더 밖 경로를 이름으로 적는 파일이 `core-link.ts` 하나이고 그 경로가 위 둘뿐임을 본다. 코어를 부르는 곳은 `MonitorRunner`(손으로 적은 좁은 타입) 하나다.
- **남는 틈.** 승인 지문과 내용 해시는 폴더만 덮으므로 worker 가 돌리는 코어 코드는 승인 범위 밖이다. 같은 릴리스 트리에서 오고 `sangsoe doctor` 의 내용 해시 점검은 폴더만 본다. 코어까지 덮으려면 승인 대상에 코어 해시를 더해야 하고, 그것은 이 유닛이 정하지 않는다.

버린 안: (가) worker 가 라운드마다 `sangsoe monitor run <name>` 을 실행 — 폴더는 닫히지만 CLI 호출자 여섯 행에 없는 일곱째 호출자가 생기고(결정 75 나) 라운드마다 프로세스와 sqlite 열기가 는다. (나) 정적 `../core/index.ts` import — 설치본에서 폴더를 복사하면 깨지고 U3 의 폴더 시험을 어긴다. (다) 번들 — 결정 109 가 아직 두지 않는다.

다시 볼 조건: Orca 가 plugin 폴더를 다른 곳으로 복사해 돌리게 되거나(그때는 결정 118 처럼 PATH 의 `sangsoe` 로 트리를 찾는다), 승인 범위를 코어까지 넓히기로 할 때.
