/**
 * Minimal JSON value types for `jsonb` columns.
 *
 * These exist for a concrete TypeORM reason, not for style. TypeORM's insert
 * value type (`QueryDeepPartialEntity`) recursively maps a column's declared
 * type, and `Record<string, unknown>` makes that recursion land on `unknown`,
 * which nothing is assignable to — so a jsonb column typed that way cannot be
 * written through a query builder at all. Declaring the shape as a concrete
 * index signature of JSON primitives keeps inserts type-checked and still
 * rejects genuinely non-serialisable values at compile time.
 */
export type JsonPrimitive = string | number | boolean | null;

/** A single JSON value: a primitive, or a flat array of primitives. */
export type JsonValue = JsonPrimitive | JsonPrimitive[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
