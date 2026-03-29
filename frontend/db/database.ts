import * as SQLite from 'expo-sqlite';
import { ALL_TABLES_SQL, DROP_ALL_TABLES } from './schema';
const DATABASE_NAME = 'udyamcoach.db';
let db: SQLite.SQLiteDatabase | null = null;
let isInitialized = false;

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db && isInitialized) return db;
  db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync('PRAGMA foreign_keys = ON;');
  for (const sql of ALL_TABLES_SQL) await db.execAsync(sql);

  try { await db.execAsync("ALTER TABLE sets_local ADD COLUMN is_warmup INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE sets_local ADD COLUMN is_dropset INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE sets_local ADD COLUMN is_failure INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE sets_local ADD COLUMN is_completed INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE exercises_local ADD COLUMN notes TEXT;"); } catch (e) {}

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
}
