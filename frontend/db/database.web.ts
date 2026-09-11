/**
 * Web stub — expo-sqlite is native-only.
 * Metro resolves this file on web instead of database.ts.
 */

const WEB_UNSUPPORTED = 'This app requires iOS or Android. SQLite is not available on web.';

export async function initDatabase(): Promise<never> {
  throw new Error(WEB_UNSUPPORTED);
}

export function getDatabase(): never {
  throw new Error(WEB_UNSUPPORTED);
}

export async function resetDatabase(): Promise<never> {
  throw new Error(WEB_UNSUPPORTED);
}
