const SYNC_COLS = `
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  local_updated_at TEXT NOT NULL,
  server_updated_at TEXT,
  deleted_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  revision INTEGER NOT NULL DEFAULT 1,
  last_synced_revision INTEGER
`;

export const CREATE_WORKOUTS_TABLE = `CREATE TABLE IF NOT EXISTS workouts_local (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  name TEXT,
  notes TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  last_synced_at TEXT,
  ${SYNC_COLS}
);`;

export const CREATE_EXERCISES_TABLE = `CREATE TABLE IF NOT EXISTS exercises_local (
  id TEXT PRIMARY KEY NOT NULL,
  workout_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  notes TEXT,
  rest_seconds INTEGER,
  ${SYNC_COLS},
  FOREIGN KEY (workout_id) REFERENCES workouts_local(id) ON DELETE CASCADE
);`;

export const CREATE_SETS_TABLE = `CREATE TABLE IF NOT EXISTS sets_local (
  id TEXT PRIMARY KEY NOT NULL,
  exercise_id TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  weight REAL,
  reps INTEGER,
  is_warmup INTEGER NOT NULL DEFAULT 0,
  is_dropset INTEGER NOT NULL DEFAULT 0,
  is_failure INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0,
  ${SYNC_COLS},
  FOREIGN KEY (exercise_id) REFERENCES exercises_local(id) ON DELETE CASCADE
);`;

export const CREATE_TEMPLATES_TABLE = `CREATE TABLE IF NOT EXISTS templates_local (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ${SYNC_COLS}
);`;

export const CREATE_TEMPLATE_EXERCISES_TABLE = `CREATE TABLE IF NOT EXISTS template_exercises_local (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  ${SYNC_COLS},
  FOREIGN KEY (template_id) REFERENCES templates_local(id) ON DELETE CASCADE
);`;

export const CREATE_TEMPLATE_SETS_TABLE = `CREATE TABLE IF NOT EXISTS template_sets_local (
  id TEXT PRIMARY KEY NOT NULL,
  template_exercise_id TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  weight REAL,
  reps INTEGER,
  is_warmup INTEGER NOT NULL DEFAULT 0,
  is_dropset INTEGER NOT NULL DEFAULT 0,
  is_failure INTEGER NOT NULL DEFAULT 0,
  ${SYNC_COLS},
  FOREIGN KEY (template_exercise_id) REFERENCES template_exercises_local(id) ON DELETE CASCADE
);`;

export const CREATE_SYNC_META_TABLE = `CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY NOT NULL,
  last_sync_token TEXT,
  last_successful_sync_at TEXT,
  last_attempted_sync_at TEXT,
  last_error TEXT,
  client_id TEXT
);`;

export const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_exercises_workout_id ON exercises_local(workout_id);
CREATE INDEX IF NOT EXISTS idx_sets_exercise_id ON sets_local(exercise_id);
CREATE INDEX IF NOT EXISTS idx_sets_exercise_order ON sets_local(exercise_id, order_index);
CREATE INDEX IF NOT EXISTS idx_workouts_status ON workouts_local(status);
CREATE INDEX IF NOT EXISTS idx_workouts_sync_status ON workouts_local(sync_status);
CREATE INDEX IF NOT EXISTS idx_workouts_deleted_at ON workouts_local(deleted_at);
CREATE INDEX IF NOT EXISTS idx_workouts_started_at ON workouts_local(started_at);
CREATE INDEX IF NOT EXISTS idx_exercises_sync_status ON exercises_local(sync_status);
CREATE INDEX IF NOT EXISTS idx_sets_sync_status ON sets_local(sync_status);
CREATE INDEX IF NOT EXISTS idx_templates_sync_status ON templates_local(sync_status);
CREATE INDEX IF NOT EXISTS idx_template_exercises_template_id ON template_exercises_local(template_id);
CREATE INDEX IF NOT EXISTS idx_template_sets_exercise_id ON template_sets_local(template_exercise_id);
`;

export const ALL_TABLES_SQL = [
  CREATE_WORKOUTS_TABLE,
  CREATE_EXERCISES_TABLE,
  CREATE_SETS_TABLE,
  CREATE_TEMPLATES_TABLE,
  CREATE_TEMPLATE_EXERCISES_TABLE,
  CREATE_TEMPLATE_SETS_TABLE,
  CREATE_SYNC_META_TABLE,
  CREATE_INDEXES,
];

export const DROP_ALL_TABLES = `
DROP TABLE IF EXISTS template_sets_local;
DROP TABLE IF EXISTS template_exercises_local;
DROP TABLE IF EXISTS templates_local;
DROP TABLE IF EXISTS sets_local;
DROP TABLE IF EXISTS exercises_local;
DROP TABLE IF EXISTS workouts_local;
DROP TABLE IF EXISTS sync_meta;
`;

export const SCHEMA_VERSION = 2;
