-- Nihongo Hub — SQLite schema.
--
-- One database file, no migrations framework: `npm run setup` runs this script
-- against db/nihongo.db. Everything is normalised around three reference tables
-- (vocabulary, kanji, grammar_points) that the importers populate, and a set of
-- user tables that the app writes to as you study.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Reference data (populated by the import scripts)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vocabulary (
  id                     INTEGER PRIMARY KEY,
  ent_seq                INTEGER UNIQUE,          -- JMdict entry sequence number
  kanji                  TEXT,                    -- primary kanji writing, may be NULL
  kanji_all              TEXT,                    -- all writings, tab separated
  reading                TEXT NOT NULL,           -- primary kana reading
  reading_all            TEXT,                    -- all readings, tab separated
  glosses                TEXT NOT NULL,           -- English senses, one per line
  pos                    TEXT,                    -- part-of-speech tags, comma separated
  priority               TEXT,                    -- JMdict ke_pri/re_pri markers
  is_common              INTEGER NOT NULL DEFAULT 0,
  jlpt_level             TEXT,                    -- N5..N1, filled by import-jlpt-vocab
  pitch_accent_pattern   TEXT,                    -- heiban/atamadaka/nakadaka/odaka
  pitch_accent_position  INTEGER,                 -- downstep position (0 = heiban)
  source                 TEXT                     -- which dataset produced the row
);

CREATE INDEX IF NOT EXISTS idx_vocab_kanji     ON vocabulary(kanji);
CREATE INDEX IF NOT EXISTS idx_vocab_reading   ON vocabulary(reading);
CREATE INDEX IF NOT EXISTS idx_vocab_jlpt      ON vocabulary(jlpt_level);
CREATE INDEX IF NOT EXISTS idx_vocab_common    ON vocabulary(is_common);

CREATE TABLE IF NOT EXISTS kanji (
  id            INTEGER PRIMARY KEY,
  character     TEXT NOT NULL UNIQUE,
  on_readings   TEXT,
  kun_readings  TEXT,
  meanings      TEXT,
  stroke_count  INTEGER,
  jlpt_level    TEXT,
  grade         INTEGER,
  frequency     INTEGER,
  radical       TEXT,
  source        TEXT
);

CREATE INDEX IF NOT EXISTS idx_kanji_jlpt ON kanji(jlpt_level);

CREATE TABLE IF NOT EXISTS grammar_points (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,             -- e.g. n5_001
  level         TEXT NOT NULL,                    -- N5..N1, or NA when untagged upstream
  pattern       TEXT NOT NULL,
  term          TEXT,
  reading       TEXT,
  meaning_en    TEXT,
  meaning_ja    TEXT,
  formation     TEXT,
  explanation   TEXT,
  examples_json TEXT NOT NULL DEFAULT '[]',       -- [{japanese, reading, english}]
  tags          TEXT,                             -- comma separated
  sources       TEXT
);

CREATE INDEX IF NOT EXISTS idx_grammar_level   ON grammar_points(level);
CREATE INDEX IF NOT EXISTS idx_grammar_pattern ON grammar_points(pattern);

CREATE TABLE IF NOT EXISTS chunks (
  id           INTEGER PRIMARY KEY,
  phrase       TEXT NOT NULL,
  reading      TEXT,
  meaning      TEXT,
  jlpt_level   TEXT,
  topic_tags   TEXT,                              -- comma separated
  source       TEXT NOT NULL DEFAULT 'seed',      -- seed | island | reader | manual
  island_id    INTEGER REFERENCES islands(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(phrase, source, island_id)
);

CREATE INDEX IF NOT EXISTS idx_chunks_level ON chunks(jlpt_level);
CREATE INDEX IF NOT EXISTS idx_chunks_island ON chunks(island_id);

-- ---------------------------------------------------------------------------
-- Knowledge graph — what the learner has met, is learning, and knows
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id            INTEGER PRIMARY KEY,
  node_type     TEXT NOT NULL,                    -- vocabulary | kanji | grammar | chunk
  ref_id        INTEGER,                          -- row id in the reference table
  surface       TEXT NOT NULL,                    -- the form as studied
  reading       TEXT,
  status        TEXT NOT NULL DEFAULT 'encountered', -- encountered | learning | known | ignored
  encounters    INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  notes         TEXT,
  UNIQUE(node_type, surface, reading)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_nodes(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_type   ON knowledge_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_ref    ON knowledge_nodes(node_type, ref_id);

-- ---------------------------------------------------------------------------
-- Reader
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS texts (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  source_url    TEXT,
  token_count   INTEGER NOT NULL DEFAULT 0,
  unique_words  INTEGER NOT NULL DEFAULT 0,
  level_summary TEXT,                             -- JSON: {"N5": 42, "N4": 11, ...}
  tokens_json   TEXT,                             -- cached analysis, JSON array
  grammar_json  TEXT,                             -- cached grammar matches, JSON array
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_texts_created ON texts(created_at DESC);

CREATE TABLE IF NOT EXISTS text_vocabulary_encounters (
  id            INTEGER PRIMARY KEY,
  text_id       INTEGER NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
  vocabulary_id INTEGER REFERENCES vocabulary(id) ON DELETE SET NULL,
  surface       TEXT NOT NULL,
  dictionary_form TEXT,
  reading       TEXT,
  sentence      TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tve_text  ON text_vocabulary_encounters(text_id);
CREATE INDEX IF NOT EXISTS idx_tve_vocab ON text_vocabulary_encounters(vocabulary_id);
CREATE INDEX IF NOT EXISTS idx_tve_surface ON text_vocabulary_encounters(surface);

CREATE TABLE IF NOT EXISTS text_grammar_encounters (
  id               INTEGER PRIMARY KEY,
  text_id          INTEGER NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
  grammar_point_id INTEGER REFERENCES grammar_points(id) ON DELETE SET NULL,
  matched_text     TEXT NOT NULL,
  sentence         TEXT NOT NULL,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tge_text ON text_grammar_encounters(text_id);

-- ---------------------------------------------------------------------------
-- SRS (FSRS scheduling state lives on the card)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS srs_cards (
  id              INTEGER PRIMARY KEY,
  card_type       TEXT NOT NULL DEFAULT 'recognition',  -- recognition | production
  node_type       TEXT NOT NULL DEFAULT 'vocabulary',   -- vocabulary | kanji | grammar | chunk | error
  ref_id          INTEGER,                              -- reference table row id
  front           TEXT NOT NULL,
  back            TEXT NOT NULL,
  reading         TEXT,
  context_sentence TEXT,
  context_translation TEXT,
  audio_path      TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',       -- reader | error_log | island | manual | studio
  source_id       INTEGER,                              -- text_id / error_id / island_id
  source_label    TEXT,
  -- FSRS state
  stage           TEXT NOT NULL DEFAULT 'new',          -- new | learning | review | relearning
  due             TEXT NOT NULL DEFAULT (datetime('now')),
  stability       REAL NOT NULL DEFAULT 0,
  difficulty      REAL NOT NULL DEFAULT 0,
  elapsed_days    INTEGER NOT NULL DEFAULT 0,
  scheduled_days  INTEGER NOT NULL DEFAULT 0,
  reps            INTEGER NOT NULL DEFAULT 0,
  lapses          INTEGER NOT NULL DEFAULT 0,
  last_review     TEXT,
  suspended       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cards_due    ON srs_cards(due);
CREATE INDEX IF NOT EXISTS idx_cards_stage  ON srs_cards(stage);
CREATE INDEX IF NOT EXISTS idx_cards_source ON srs_cards(source);
CREATE INDEX IF NOT EXISTS idx_cards_ref    ON srs_cards(node_type, ref_id, card_type);

CREATE TABLE IF NOT EXISTS srs_reviews (
  id             INTEGER PRIMARY KEY,
  card_id        INTEGER NOT NULL REFERENCES srs_cards(id) ON DELETE CASCADE,
  rating         INTEGER NOT NULL,                -- 1 Again, 2 Hard, 3 Good, 4 Easy
  state          TEXT,
  reviewed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  elapsed_days   INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  stability      REAL,
  difficulty     REAL,
  duration_ms    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reviews_card ON srs_reviews(card_id);
CREATE INDEX IF NOT EXISTS idx_reviews_time ON srs_reviews(reviewed_at);

-- ---------------------------------------------------------------------------
-- Oral Studio
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS speaking_sessions (
  id             INTEGER PRIMARY KEY,
  session_type   TEXT NOT NULL,                   -- 432 | shadowing | free
  topic          TEXT,
  island_id      INTEGER REFERENCES islands(id) ON DELETE SET NULL,
  plan_notes     TEXT,
  target_chunks  TEXT,                            -- JSON array of chunk ids/phrases
  transcript     TEXT,
  corrections    TEXT,
  duration_sec   INTEGER NOT NULL DEFAULT 0,
  material_title TEXT,                            -- shadowing: what was shadowed
  text_id        INTEGER REFERENCES texts(id) ON DELETE SET NULL,
  ipom_stage     TEXT,                            -- scripted | prosodic | content
  reps           INTEGER,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_type ON speaking_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_sessions_time ON speaking_sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS session_recordings (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES speaking_sessions(id) ON DELETE CASCADE,
  phase        INTEGER NOT NULL DEFAULT 1,        -- 1 | 2 | 3 for 4/3/2
  file_path    TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recordings_session ON session_recordings(session_id);

CREATE TABLE IF NOT EXISTS fluency_metrics (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES speaking_sessions(id) ON DELETE CASCADE,
  phase        INTEGER NOT NULL DEFAULT 1,
  wpm          REAL,
  pause_count  INTEGER,
  word_count   INTEGER,
  duration_sec INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fluency_session ON fluency_metrics(session_id);

-- ---------------------------------------------------------------------------
-- Island Workshop
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS islands (
  id               INTEGER PRIMARY KEY,
  topic            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',  -- draft|translated|verified|drilling|deployable
  register         TEXT NOT NULL DEFAULT 'teineigo', -- teineigo | tameguchi
  l1_script        TEXT,
  l2_translation   TEXT,
  verified_version TEXT,
  notes            TEXT,
  last_practiced_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_islands_status ON islands(status);

CREATE TABLE IF NOT EXISTS island_drills (
  id                INTEGER PRIMARY KEY,
  island_id         INTEGER NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  step              INTEGER NOT NULL DEFAULT 1,     -- 1 = L2->L1, 2 = L1->L2
  l1_back_translation TEXT,
  l2_reconstruction TEXT,
  diff_json         TEXT,
  available_at      TEXT,                           -- when step 2 unlocks
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_drills_island ON island_drills(island_id);

CREATE TABLE IF NOT EXISTS communication_tools (
  id         INTEGER PRIMARY KEY,
  island_id  INTEGER REFERENCES islands(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'linking',       -- linking | shifting | embellishing
  phrase     TEXT NOT NULL,
  reading    TEXT,
  meaning    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tools_island ON communication_tools(island_id);

-- ---------------------------------------------------------------------------
-- Error Log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS errors (
  id               INTEGER PRIMARY KEY,
  occurred_at      TEXT NOT NULL DEFAULT (datetime('now')),
  source_activity  TEXT NOT NULL DEFAULT 'manual',  -- 432|shadowing|free|island|reader|manual
  source_id        INTEGER,
  attempted        TEXT NOT NULL,                   -- what I tried to say
  error_text       TEXT,                            -- the incorrect fragment
  corrected        TEXT NOT NULL,                   -- the corrected version
  category         TEXT NOT NULL DEFAULT 'other',   -- particle|conjugation|register|word_choice|pitch|other
  grammar_point_id INTEGER REFERENCES grammar_points(id) ON DELETE SET NULL,
  notes            TEXT,
  srs_card_id      INTEGER REFERENCES srs_cards(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_errors_category ON errors(category);
CREATE INDEX IF NOT EXISTS idx_errors_time     ON errors(occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Activity log — feeds the dashboard timeline, streak and Four Strands audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activity_log (
  id           INTEGER PRIMARY KEY,
  activity     TEXT NOT NULL,                      -- reader_analyze|srs_review|432_session|...
  strand       TEXT,                               -- input|output|language_focused|fluency
  ref_table    TEXT,
  ref_id       INTEGER,
  detail       TEXT,
  minutes      REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_time   ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_strand ON activity_log(strand);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_meta (
  id          INTEGER PRIMARY KEY,
  dataset     TEXT NOT NULL,
  source_url  TEXT,
  row_count   INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes       TEXT
);
