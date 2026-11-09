# 121. 워커와 리드의 끝은 `/goal` 이 아니라 Dispatch 와 worker_done 이다

design `#roles` 와 부록 `#role-cards` 는 리드·워커의 완료를 "/goal 이 판정할 때"로 적었다. 판단 층의 프롬프트는 이것을 "완료 조건을 채운 증거 + 자기 Dispatch 로 보내는 worker_done 한 번"으로 쓴다.

## 이유

- `worker-start` 로 연 세션의 첫 프롬프트는 Orca 가 자기 문구("Please carry out this task from my Orca coordinator…")로 감싸고 브리프를 붙여 넣는다. 그래서 브리프 안의 `/goal` 줄은 명령으로 걸리지 않는다(이 프로그램에서 관찰). 리드도 오케스트레이터 Run 의 Dispatch 를 가진 워커로 시작하므로 같다. #13 의 검증도 리드 첫 프롬프트의 `/goal` 을 NOT VERIFIED 로 남겼다.
- 감독되는 세션의 끝을 Orca 가 아는 길은 worker_done 하나다. 자동 해제·`worker-list`·보고 주소가 모두 Dispatch 에 묶여 있다(결정 94).

## 바뀌는 것

- `write-brief` 는 완료 조건을 `/goal` 이 아니라 브리프 본문에 확인 방법과 함께 쓰라고 한다.
- 리드는 완료 조건마다 증거를 확인한 뒤 worker_done 을 보낸다. 오케스트레이터는 그 보고를 읽기 전용 서브에이전트로 확인한 뒤 오너에게 끝났다고 말한다.
- design·부록의 문장은 고치지 않았다(이 단위의 범위 밖). 설계 대 코드 대조 단위가 접는다.

## 확인하지 못한 것

- 리드가 자기 Run 을 쥐는 길. 시작 함수는 리드의 Run 이 그 Dispatch 의 Run 과 달라야 한다고 본다. 프롬프트는 "SessionStart hook 이 붙였으면 쓰고, 없으면 Orca 로 Run 을 만들어 `run-use`"라고 쓴다. Dispatch 를 가진 세션이 `run-create`·`run-use` 를 할 수 있는지는 실제 Orca 로 재지 않았다.
- `start_unit` 이 연 세션이 `lead`·`worker` agent 정의를 싣는 길. `start_unit` 은 Orca agent id 만 넘기고, 역할은 spec 첫 줄의 `sangsoe-role:` 줄이다. 그 줄로 agent 정의를 붙이는 것은 SessionStart hook 단위의 몫이다.
