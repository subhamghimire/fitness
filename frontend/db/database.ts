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
