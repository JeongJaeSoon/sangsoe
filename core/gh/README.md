<!-- layout: slot=④ layer=실행 tokens=free -->
# core/gh — GitHub 클라이언트

코어가 GitHub 을 읽는 유일한 자리다. `gh api -i` 로 부르고 응답마다 남은 한도(`gh_budget`)와 ETag(`gh_seen`)를 `GhCache` 에 적는다. 캐시를 sqlite 에 두는 것은 저장소 단위의 몫이고, 여기서는 인터페이스와 메모리 구현만 둔다.

- `client.ts` — `createGhClient`·`GhCache`·`budgetLevel`(30% 아래 느리게, 10% 아래 필수만). 한도가 0 이면 초기화 시각까지 부르지 않고 `rate_limited` 를 낸다.
- `merge-conditions.ts` — 결정 81 의 조건 넷(필수 리뷰·CI, 최신 main 또는 병합 대기열, 새 push 로 승인 무효, 보호 경로 안 건드림). 읽지 못한 설정은 거짓이다.
