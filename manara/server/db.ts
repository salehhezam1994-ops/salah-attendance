import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

/**
 * Data model. Logical entities from the spec map to tables as follows
 * (some merged to keep relations simple):
 *   Users, UserPreferences            -> users, preferences
 *   LearningJourneys, JourneyGoals    -> journeys (goal_json holds the structured goal)
 *   KnowledgeStages                   -> stages
 *   KnowledgeTopics + KnowledgeNodes  -> nodes (tree via parent_id; kind = root/trunk/branch/leaf)
 *   KnowledgeRelations                -> relations (typed: historical, conceptual, influence, ...)
 *   DailyLessons, LessonSections      -> lessons, lesson_sections (5 depth levels)
 *   Sources, SourceReferences         -> sources, excerpts (verbatim text tied to a source), source_refs
 *   UserNotes                         -> notes
 *   UserQuestions, UserAnswers        -> review_items (question + expected answer) and review_answers
 *   LearningProgress                  -> progress_events (+ node status/mastery)
 *   ReviewItems, ReviewSessions       -> review_items, review_sessions
 *   Notifications                     -> notifications
 *   Subscriptions, UsageLimits        -> subscriptions, usage
 *   AIConversations(+Messages)        -> conversations, conversation_messages
 *   (scientific updates tracking)     -> updates
 */
const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  password_hash TEXT,
  is_guest INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,               -- interviewing | confirming | planning | proposed | active | paused | archived
  interview_json TEXT NOT NULL,       -- slot values gathered in the interview
  goal_json TEXT,                     -- structured goal (Goal Analysis Agent)
  plan_json TEXT,                     -- plan overview (duration, phases text, schedule)
  pending_change_json TEXT,           -- a proposed plan change awaiting confirmation
  map_model TEXT NOT NULL DEFAULT 'tree',
  ai_mode TEXT NOT NULL,              -- anthropic | demo : how its content was produced
  created_at TEXT NOT NULL,
  started_at TEXT,
  last_active_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_journeys_user ON journeys(user_id);
CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  weeks INTEGER
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  stage_id TEXT REFERENCES stages(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- root | trunk | branch | leaf
  title TEXT NOT NULL,
  summary TEXT,
  order_idx INTEGER NOT NULL,
  lesson_order INTEGER,               -- position in the daily sequence (null = structural only)
  status TEXT NOT NULL DEFAULT 'upcoming', -- upcoming | current | done | skipped
  mastery REAL NOT NULL DEFAULT 0,
  search_queries TEXT,                -- JSON array, used by the research agent
  pos_x REAL, pos_y REAL              -- user-arranged positions on the map
);
CREATE INDEX IF NOT EXISTS idx_nodes_journey ON nodes(journey_id);
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  from_node TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_node TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                 -- prerequisite | historical | conceptual | influence | disagreement | application
  note TEXT
);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  key_question TEXT,
  status TEXT NOT NULL,               -- planned | generating | ready | failed | read
  error TEXT,
  minutes INTEGER,
  saved INTEGER NOT NULL DEFAULT 0,
  max_level_opened INTEGER NOT NULL DEFAULT 1,
  content_mode TEXT,                  -- anthropic | demo
  verification_json TEXT,             -- report from the citation/verification module
  generated_at TEXT,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lessons_journey ON lessons(journey_id, seq);
CREATE TABLE IF NOT EXISTS lesson_sections (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,             -- 1 summary .. 5 sources & further study
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  minutes INTEGER,
  body_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- book | article | paper | thesis | reference | encyclopedia | web | primary | official | dataset
  title TEXT NOT NULL,
  authors TEXT,
  year TEXT,
  publisher TEXT,
  doi TEXT,
  url TEXT,
  language TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,               -- web_search | openalex | crossref | wikipedia | openlibrary | user
  verification_status TEXT NOT NULL,  -- verified | located | unverified | failed
  verification_note TEXT,
  accessed_at TEXT NOT NULL,
  UNIQUE(journey_id, url)
);
CREATE TABLE IF NOT EXISTS excerpts (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  text TEXT NOT NULL,                 -- verbatim text returned by the search/source API
  locator TEXT,                       -- page / section when known
  origin TEXT NOT NULL                -- search_citation | abstract | summary
);
CREATE TABLE IF NOT EXISTS source_refs (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  excerpt_id TEXT REFERENCES excerpts(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS node_sources (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY(node_id, source_id)
);
CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  definition TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id TEXT REFERENCES journeys(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'recall',  -- recall | choice
  options_json TEXT,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due_at TEXT NOT NULL,
  last_result TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_due ON review_items(user_id, due_at);
CREATE TABLE IF NOT EXISTS review_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  remembered INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS review_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES review_sessions(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES review_items(id) ON DELETE CASCADE,
  user_answer TEXT,
  result TEXT NOT NULL,              -- remembered | partial | forgot
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS progress_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                -- read | more | discuss | review | listen
  seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id TEXT REFERENCES journeys(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                -- interview | tutor
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                -- user | assistant
  content TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id TEXT REFERENCES journeys(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- daily | review | comeback | update
  title TEXT NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE TABLE IF NOT EXISTS updates (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  published TEXT,
  category TEXT NOT NULL,            -- important | regular | opinion | unconfirmed | preliminary
  relation TEXT,                     -- how it relates to what the user learned
  recommend_add INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',-- new | added | dismissed
  found_at TEXT NOT NULL,
  UNIQUE(journey_id, url)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,                -- trial | basic | pro | academic
  status TEXT NOT NULL,              -- active | expired
  started_at TEXT NOT NULL,
  ends_at TEXT
);
CREATE TABLE IF NOT EXISTS usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL,              -- YYYY-MM
  metric TEXT NOT NULL,              -- lessons | tutor | research | plans
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, period, metric)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- webpush | fcm
  endpoint TEXT NOT NULL UNIQUE,     -- Web Push endpoint URL or FCM registration token
  keys_json TEXT,                    -- Web Push p256dh/auth keys
  platform TEXT,                     -- web | android | ios
  created_at TEXT NOT NULL,
  last_ok_at TEXT,
  failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS push_log (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- daily | comeback | update | test
  day TEXT NOT NULL,                 -- learner's local date YYYY-MM-DD
  sent_at TEXT NOT NULL,
  PRIMARY KEY(user_id, kind, day)
);
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  context TEXT NOT NULL,
  message TEXT NOT NULL
);
`;

let _db: DatabaseSync | null = null;

export function openDb(file?: string): DatabaseSync {
  const target = file ?? path.join(config.dataDir, 'manara.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive migrations for databases created by earlier versions. */
function migrate(d: DatabaseSync) {
  const has = (table: string, col: string) => (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
  if (!has('journeys', 'updates_checked_at')) d.exec('ALTER TABLE journeys ADD COLUMN updates_checked_at TEXT');
  if (!has('notifications', 'url')) d.exec('ALTER TABLE notifications ADD COLUMN url TEXT');
  if (!has('notifications', 'delivered')) d.exec('ALTER TABLE notifications ADD COLUMN delivered INTEGER NOT NULL DEFAULT 0');
}

export function db(): DatabaseSync {
  if (!_db) _db = openDb(process.env.MANARA_DB_FILE);
  return _db;
}

/** For tests: swap in an isolated database. */
export function setDb(d: DatabaseSync) {
  _db = d;
}

type Param = string | number | null | bigint | Uint8Array;
export const q = {
  get<T>(sql: string, ...p: Param[]): T | undefined {
    return db().prepare(sql).get(...p) as T | undefined;
  },
  all<T>(sql: string, ...p: Param[]): T[] {
    return db().prepare(sql).all(...p) as T[];
  },
  run(sql: string, ...p: Param[]) {
    return db().prepare(sql).run(...p);
  },
  tx<T>(fn: () => T): T {
    const d = db();
    d.exec('BEGIN');
    try {
      const r = fn();
      d.exec('COMMIT');
      return r;
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  },
};
