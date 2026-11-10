import { bool, defineEvent, int, oneOf, opt } from "../define.ts";

export default defineEvent("reap_round", {
  trigger: oneOf("timer", "hint"),
  roots_ok: bool,
  round: int,
  mark_only: opt(bool),
  cards: opt(int),
  marked: opt(int),
  candidates: opt(int),
  reaped: opt(int),
  unknown: opt(int),
  docker_skipped: opt(bool),
});
