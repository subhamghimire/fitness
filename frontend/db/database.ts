import * as SQLite from 'expo-sqlite';
import { ALL_TABLES_SQL, DROP_ALL_TABLES, SCHEMA_VERSION, CREATE_SYNC_META_TABLE } from './schema';
import { generateId } from '@/utils/uuid';

const DATABASE_NAME = 'udyamcoach.db';
let db: SQLite.SQLiteDatabase | null = null;
let isInitialized = false;

const ALTER_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'workouts_local', column: 'name', ddl: 'TEXT' },
  { table: 'workouts_local', column: 'notes', ddl: 'TEXT' },
  { table: 'workouts_local', column: 'user_id', ddl: 'TEXT' },
  { table: 'workouts_local', column: 'created_at', ddl: 'TEXT' },
  { table: 'workouts_local', column: 'updated_at', ddl: 'TEXT' },
  { table: 'workouts_local', column: 'local_updated_at', ddl: 'TEXT' },
  { table: 'workouts_local', column: 'server_updated_at', ddl: 'TEXT' },
  { table: 'workouts_local', column: 'deleted_at', ddl: 'TEXT' },
  { table: 'workouts_local', column: 'sync_status', ddl: "TEXT NOT NULL DEFAULT 'pending'" },
  { table: 'workouts_local', column: 'revision', ddl: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'workouts_local', column: 'last_synced_revision', ddl: 'INTEGER' },

  { table: 'exercises_local', column: 'notes', ddl: 'TEXT' },
  { table: 'exercises_local', column: 'rest_seconds', ddl: 'INTEGER' },
  { table: 'exercises_local', column: 'user_id', ddl: 'TEXT' },
  { table: 'exercises_local', column: 'created_at', ddl: 'TEXT' },
  { table: 'exercises_local', column: 'updated_at', ddl: 'TEXT' },
  { table: 'exercises_local', column: 'local_updated_at', ddl: 'TEXT' },
  { table: 'exercises_local', column: 'server_updated_at', ddl: 'TEXT' },
  { table: 'exercises_local', column: 'deleted_at', ddl: 'TEXT' },
  { table: 'exercises_local', column: 'sync_status', ddl: "TEXT NOT NULL DEFAULT 'pending'" },
  { table: 'exercises_local', column: 'revision', ddl: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'exercises_local', column: 'last_synced_revision', ddl: 'INTEGER' },

  { table: 'sets_local', column: 'order_index', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'sets_local', column: 'is_warmup', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'sets_local', column: 'is_dropset', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'sets_local', column: 'is_failure', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'sets_local', column: 'is_completed', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'sets_local', column: 'user_id', ddl: 'TEXT' },
  { table: 'sets_local', column: 'created_at', ddl: 'TEXT' },
  { table: 'sets_local', column: 'updated_at', ddl: 'TEXT' },
  { table: 'sets_local', column: 'local_updated_at', ddl: 'TEXT' },
  { table: 'sets_local', column: 'server_updated_at', ddl: 'TEXT' },
  { table: 'sets_local', column: 'deleted_at', ddl: 'TEXT' },
  { table: 'sets_local', column: 'sync_status', ddl: "TEXT NOT NULL DEFAULT 'pending'" },
  { table: 'sets_local', column: 'revision', ddl: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'sets_local', column: 'last_synced_revision', ddl: 'INTEGER' },

  { table: 'templates_local', column: 'user_id', ddl: 'TEXT' },
  { table: 'templates_local', column: 'updated_at', ddl: 'TEXT' },
  { table: 'templates_local', column: 'local_updated_at', ddl: 'TEXT' },
  { table: 'templates_local', column: 'server_updated_at', ddl: 'TEXT' },
  { table: 'templates_local', column: 'deleted_at', ddl: 'TEXT' },
  { table: 'templates_local', column: 'sync_status', ddl: "TEXT NOT NULL DEFAULT 'pending'" },
  { table: 'templates_local', column: 'revision', ddl: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'templates_local', column: 'last_synced_revision', ddl: 'INTEGER' },

  { table: 'template_exercises_local', column: 'user_id', ddl: 'TEXT' },
  { table: 'template_exercises_local', column: 'created_at', ddl: 'TEXT' },
  { table: 'template_exercises_local', column: 'updated_at', ddl: 'TEXT' },
  { table: 'template_exercises_local', column: 'local_updated_at', ddl: 'TEXT' },
  { table: 'template_exercises_local', column: 'server_updated_at', ddl: 'TEXT' },
  { table: 'template_exercises_local', column: 'deleted_at', ddl: 'TEXT' },
  { table: 'template_exercises_local', column: 'sync_status', ddl: "TEXT NOT NULL DEFAULT 'pending'" },
  { table: 'template_exercises_local', column: 'revision', ddl: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'template_exercises_local', column: 'last_synced_revision', ddl: 'INTEGER' },

  { table: 'template_sets_local', column: 'order_index', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'template_sets_local', column: 'user_id', ddl: 'TEXT' },
  { table: 'template_sets_local', column: 'created_at', ddl: 'TEXT' },
  { table: 'template_sets_local', column: 'updated_at', ddl: 'TEXT' },
  { table: 'template_sets_local', column: 'local_updated_at', ddl: 'TEXT' },
  { table: 'template_sets_local', column: 'server_updated_at', ddl: 'TEXT' },
  { table: 'template_sets_local', column: 'deleted_at', ddl: 'TEXT' },
  { table: 'template_sets_local', column: 'sync_status', ddl: "TEXT NOT NULL DEFAULT 'pending'" },
  { table: 'template_sets_local', column: 'revision', ddl: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'template_sets_local', column: 'last_synced_revision', ddl: 'INTEGER' },
];

async function tableHasColumn(
  database: SQLite.SQLiteDatabase,
  table: string,
  column: string
): Promise<boolean> {
  const rows = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

async function ensureColumns(database: SQLite.SQLiteDatabase): Promise<void> {
  for (const { table, column, ddl } of ALTER_COLUMNS) {
    try {
      const exists = await tableHasColumn(database, table, column);
      if (exists) continue;
      await database.runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Ignore races / already-exists from older SQLite builds
      if (/duplicate column/i.test(message)) continue;
      throw error;
    }
  }
}

async function backfillSyncMetadata(database: SQLite.SQLiteDatabase): Promise<void> {
  const now = new Date().toISOString();

  // Map legacy status='synced' → completed + sync_status synced
  await database.runAsync(
    `UPDATE workouts_local SET status = 'completed', sync_status = 'synced', last_synced_revision = COALESCE(revision, 1)
     WHERE status = 'synced'`
  );

  await database.runAsync(
    `UPDATE workouts_local SET sync_status = 'pending'
     WHERE status = 'completed' AND (last_synced_at IS NULL) AND (sync_status IS NULL OR sync_status = '')`
  );

  await database.runAsync(
    `UPDATE workouts_local SET sync_status = 'pending'
     WHERE status = 'active' AND (sync_status IS NULL OR sync_status = '')`
  );

  const tables = [
    'workouts_local',
    'exercises_local',
    'sets_local',
    'templates_local',
    'template_exercises_local',
    'template_sets_local',
  ];

  for (const table of tables) {
    const timeSource =
      table === 'workouts_local'
        ? `COALESCE(started_at, '${now}')`
        : table === 'templates_local'
          ? `COALESCE(created_at, '${now}')`
          : `'${now}'`;

    await database.runAsync(
      `UPDATE ${table} SET
        created_at = COALESCE(created_at, ${timeSource}),
        updated_at = COALESCE(updated_at, ${timeSource}),
        local_updated_at = COALESCE(local_updated_at, ${timeSource}),
        sync_status = COALESCE(NULLIF(sync_status, ''), 'pending'),
        revision = COALESCE(revision, 1)
       WHERE created_at IS NULL OR updated_at IS NULL OR local_updated_at IS NULL OR sync_status IS NULL OR sync_status = ''`
    );
  }

  // Ensure sync_meta row
  const meta = await database.getFirstAsync<{ key: string }>(`SELECT key FROM sync_meta WHERE key = 'default'`);
  if (!meta) {
    await database.runAsync(
      `INSERT INTO sync_meta (key, last_sync_token, last_successful_sync_at, last_attempted_sync_at, last_error, client_id)
       VALUES ('default', NULL, NULL, NULL, NULL, ?)`,
      [generateId()]
    );
  } else {
    const row = await database.getFirstAsync<{ client_id: string | null }>(
      `SELECT client_id FROM sync_meta WHERE key = 'default'`
    );
    if (!row?.client_id) {
      await database.runAsync(`UPDATE sync_meta SET client_id = ? WHERE key = 'default'`, [generateId()]);
    }
  }

  await database.runAsync(
    `INSERT OR REPLACE INTO sync_meta (key, last_sync_token, last_successful_sync_at, last_attempted_sync_at, last_error, client_id)
     SELECT 'schema_version', ?, NULL, NULL, NULL, NULL
     WHERE NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'schema_version')`,
    [String(SCHEMA_VERSION)]
  );
  await database.runAsync(
    `UPDATE sync_meta SET last_sync_token = ? WHERE key = 'schema_version'`,
    [String(SCHEMA_VERSION)]
  );
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db && isInitialized) return db;
  db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync('PRAGMA foreign_keys = ON;');
  for (const sql of ALL_TABLES_SQL) {
    try {
      await db.execAsync(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Older DBs may already have tables; duplicate-column CREATE should never block boot
      if (/duplicate column/i.test(message) || /already exists/i.test(message)) continue;
      throw error;
    }
  }
  await db.execAsync(CREATE_SYNC_META_TABLE);
  await ensureColumns(db);
  await backfillSyncMetadata(db);
  isInitialized = true;
  return db;
}

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db || !isInitialized) throw new Error('Database not initialized');
  return db;
}

export async function resetDatabase(): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.execAsync(DROP_ALL_TABLES);
  for (const sql of ALL_TABLES_SQL) await db.execAsync(sql);
  await backfillSyncMetadata(db);
}
