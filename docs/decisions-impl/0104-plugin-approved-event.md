# 104. 승인 event 이름은 `plugin_approved` 다

결정 77 다가 "승인 event 를 남긴다"고만 하고 이름을 주지 않았다. `sangsoe plugin approve` 가 `orca plugin enable` 에 성공한 뒤에만 한 줄을 남긴다: `{type: "plugin_approved", key, version, fingerprint, commit, at}`. 실패·dry run·이미 승인된 경우에는 남기지 않는다. 오너 항목 검증 kind `plugin_approved`(결정 91 ②)와 이름이 같은 것은 일부러다: 그 probe 는 Orca 의 승인 상태를 읽고, 이 event 는 sangsoe 가 그 승인을 했다는 기록이다. Orca 가 가진 승인 상태 자체(`orca plugin list` 의 `status`)는 복사하지 않는다(결정 74).

U1 의 event 표가 생기기 전까지 `core/approve/ports.ts` 는 이 줄을 표준 출력으로 낸다. U1 이 이 타입을 계약 폴더로 옮기고 기록 포트를 표에 잇는다.
