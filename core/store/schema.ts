// sqlite schema (appendix #schema). `event` is the only record of truth; `owner_text` keeps the masked
// owner text apart so it can be emptied; counter/migration are bookkeeping; pr_ref/gh_budget/gh_seen
// are the three caches the appendix's exception table allows. Nothing here copies an Orca fact.

export const SCHEMA_V = 1;

export const DDL = `
CREATE TABLE event (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  type       TEXT NOT NULL,
  source     TEXT NOT NULL,
  target     TEXT,
  subject    TEXT,
  entity     TEXT,
  entity_id  TEXT,
  actor      TEXT,
  needs      TEXT NOT NULL DEFAULT 'none' CHECK (needs IN ('none','action','judgment')),
  severity   TEXT,
  dedupe_key TEXT,
  schema_v   INTEGER NOT NULL DEFAULT 1,
  before     TEXT,
  after      TEXT,
  UNIQUE (dedupe_key)
);
CREATE TRIGGER event_no_update BEFORE UPDATE ON event BEGIN SELECT RAISE(ABORT, 'event is append-only'); END;
CREATE TRIGGER event_no_delete BEFORE DELETE ON event BEGIN SELECT RAISE(ABORT, 'event is append-only'); END;
CREATE INDEX event_entity ON event (entity, entity_id, seq);
CREATE INDEX event_subject ON event (subject, seq);
CREATE INDEX event_type ON event (type, seq);
CREATE INDEX event_target_notified ON event (target, type, seq) WHERE type = 'notified';
CREATE INDEX event_task ON event (json_extract(after, '$.task'), seq);

CREATE TABLE owner_text (
  seq  INTEGER PRIMARY KEY REFERENCES event (seq),
  text TEXT
);
CREATE TRIGGER owner_text_owner_action_only BEFORE INSERT ON owner_text
WHEN NEW.text IS NULL OR NOT EXISTS (SELECT 1 FROM event WHERE seq = NEW.seq AND type = 'owner_action')
BEGIN SELECT RAISE(ABORT, 'owner_text holds the text of an owner_action row'); END;
CREATE TRIGGER owner_text_redact_only BEFORE UPDATE ON owner_text
WHEN NOT (
  NEW.seq = OLD.seq AND NEW.text IS NULL AND OLD.text IS NOT NULL
  AND EXISTS (SELECT 1 FROM event WHERE type = 'owner_text_redacted' AND json_extract(after, '$.seq') = OLD.seq)
)
BEGIN SELECT RAISE(ABORT, 'owner_text may only be emptied, after its owner_text_redacted event'); END;
CREATE TRIGGER owner_text_no_delete BEFORE DELETE ON owner_text
BEGIN SELECT RAISE(ABORT, 'owner_text rows are never deleted'); END;

CREATE TABLE counter (
  name TEXT PRIMARY KEY,
  last INTEGER NOT NULL
);
CREATE TABLE migration (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  note       TEXT NOT NULL
);

CREATE TABLE pr_ref (
  repo       TEXT NOT NULL,
  number     INTEGER NOT NULL,
  state      TEXT NOT NULL,
  ci         TEXT,
  review     TEXT,
  merged_at  TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (repo, number)
);
CREATE TABLE gh_budget (
  kind      TEXT PRIMARY KEY,
  remaining INTEGER NOT NULL,
  lim       INTEGER NOT NULL,
  reset_at  TEXT NOT NULL,
  seen_at   TEXT NOT NULL
);
CREATE TABLE gh_seen (
  url     TEXT PRIMARY KEY,
  etag    TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
`;

/** Every table the schema may hold. A table outside this list (a view cache, an Orca copy) fails a test. */
export const TABLES = ["event", "owner_text", "counter", "migration", "pr_ref", "gh_budget", "gh_seen"] as const;
