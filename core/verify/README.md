<!-- layout: slot=④ layer=실행 tokens=free -->
# core/verify — 검증 등급과 증거 · 실행

입출력 없는 순수 함수만 둔다(결정 85). GitHub 과 store 를 읽는 쪽은 `core/land` 다.

- `verify-tier.ts` — `verifyTier(diff, labels, config)` → `{computed, requested?, effective, accepted, reason, files}`(`verify_tier_set` 의 칸 그대로라 pr-monitor 가 그대로 쓸 수 있다). `requiredEvidence(verdict)` 는 land 가 그 head 에 요구하는 증거 `kind` 목록.
- `evidence.ts` — `evidenceGaps(events, {pr, head, author, kinds})`: 종류마다 그 PR·head 의 마지막 줄(작성자가 쓴 줄과 쓴 이가 없는 줄은 세지 않음)이 `exit_code` 0 이고 `not_verified` 가 비지 않았는지. `mergedItemMark`: `deploys_after` 가 있는 항목은 dev 칸(`stage_recorded`)과 통과한 `dev` 증거가 있어야 `done`, 아니면 `unverified`(🔍).
