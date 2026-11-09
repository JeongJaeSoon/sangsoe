# 123. approve 는 enable 전에 store 를 연다

결정 104 의 `plugin_approved` 를 쓰는 순서를 바꾼다. 전에는 `orca plugin enable` 이 끝난 뒤에 store 를 열어 기록했다. 그 열기가 실패하면(잠김, 네트워크 파일 시스템, 하한 아래 SQLite) plugin 은 켜졌는데 `plugin_approved` 는 없다.

- **포트.** `ApprovePorts.record(event)` 를 `openLedger(): Promise<{ record(event); close() }>` 로 바꿨다. `approvePlugin` 은 모든 조건과 두 번째 내용 측정이 통과한 뒤, enable 바로 앞에서 연다. 열지 못하면 `not enabled: the store cannot take plugin_approved: …` 로 끝나고 enable 을 부르지 않는다. 연 store 는 enable 과 기록을 거쳐 `finally` 에서 닫는다.
- **dry run 은 열지 않는다.** dry run 은 쓰지 않는다. store 를 열 수 있는지는 조건 (1) 의 리뷰 증거 읽기가 이미 본다(못 열면 증거 없음).
- **남는 틈.** enable 이 성공한 뒤 열린 store 에 쓰는 `append` 가 실패하는 경우다(디스크가 그 사이에 찬다). 그때는 예외가 그대로 올라가 명령이 실패로 끝나고, plugin 은 켜진 채 기록이 없다. 열기 실패보다 훨씬 드물어 되돌리기(disable)는 두지 않았다.
