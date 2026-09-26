import { createHash } from "node:crypto";
/**
 * A tiny in-memory query-builder fake for TypeORM.
 *
 * The coach dashboard expresses most of its logic in SQL (scoping predicates,
 * soft-delete filters, window joins, GROUP BY rollups). Mocking repositories
 * with fixed return values would let a regression in those predicates pass
 * unnoticed — which is exactly the class of bug these e2e tests exist to catch.
 *
 * So this fake actually *evaluates* the predicates the service emits against
 * fixture rows, honouring INNER JOIN semantics, soft-delete predicates, IN
 * lists, subquery/CTE membership, GROUP BY aggregates, ROW_NUMBER windows,
 * ordering and pagination. It understands the dialect subset the service uses
 * and throws loudly on anything it does not recognise, so the fake can never
 * silently "pass" a query it does not actually model.
 */
export type Row = Record<string, any>;

export type JoinResolver = (alias: string, row: Row) => Row | null;

interface Predicate {
  sql: string;
  params: Record<string, unknown>;
}

interface Selection {
  sql: string;
  alias: string;
}

interface Join {
  target: unknown;
  alias: string;
  condition: string | null;
}

const DAY_MS = 86_400_000;

const subqueryRegistry = new Map<string, FakeQueryBuilder>();

/** Values that are safe to stringify in a comparison or a `||` concatenation. */
const isScalar = (value: unknown): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/**
 * Comparison key. `Date` values and date-like strings (the shape Postgres hands
 * back for timestamp columns) compare as instants; anything else numeric
 * compares numerically. Returns `null` for values that cannot be ordered, so
 * callers never have to cast an `unknown` into a number.
 */
const comparable = (value: unknown): number | null => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return new Date(value).getTime();
  if (isScalar(value)) return Number(value);
  return null;
};

const dateKey = (value: unknown): string => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value));

const truncate = (unit: string, value: unknown): unknown => {
  if (!(value instanceof Date)) return value;
  const d = new Date(value);
  if (unit === "week") {
    // Postgres date_trunc('week', ...) is ISO Monday-based.
    const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (weekday - 1));
  }
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Reads a column reference from an already-joined view. `filtered()` parks each
 * INNER JOINed row under its alias (`view.u`), so `u.name` must be read from
 * the nested object while `cc.status` reads from the base row — a projection
 * that quietly returned `undefined` here would make joined columns look like
 * nulls to every assertion downstream.
 */
const readRef = (row: Row, ref: string): unknown => {
  const text = ref.trim();
  const qualified = /^(\w+)\.(\w+)$/.exec(text);
  if (qualified) {
    const joined: unknown = row[qualified[1]];
    if (joined !== null && typeof joined === "object") return (joined as Row)[qualified[2]];
    return row[qualified[2]];
  }
  return row[text];
};

/** Resolves `<alias>.<column>` / bare column / to_char / date_trunc / `||` casts. */
const evaluate = (expr: string, row: Row): unknown => {
  const text = expr.trim();

  // Concatenation: `a || ':' || b` — evaluated left to right, operands may be
  // literals, column refs or casts.
  if (text.includes("||")) {
    return text
      .split("||")
      .map((part) => {
        const operand = evaluate(part.trim(), row);
        if (operand == null) return "";
        if (!isScalar(operand)) throw new Error(`FakeQueryBuilder: cannot concatenate non-text operand of "${text}"`);
        return String(operand);
      })
      .join("");
  }

  const toChar = /^to_char\(\s*([\w.]+)\s*,\s*'YYYY-MM-DD'\s*\)$/.exec(text);
  if (toChar) return dateKey(readRef(row, toChar[1]));
  const dateTrunc = /^date_trunc\(\s*'(\w+)'\s*,\s*([\w.]+)\s*\)$/.exec(text);
  if (dateTrunc) return truncate(dateTrunc[1], readRef(row, dateTrunc[2]));

  // Explicit cast: `<alias>.<column>::text` (the alias is part of the reference,
  // so `cc.id::text` and `u.id::text` must not collapse onto the same column).
  const cast = /^(.+?)::\w+$/.exec(text);
  if (cast) return readRef(row, cast[1]);

  return readRef(row, text);
};

const isAggregate = (sql: string): boolean => /(^|\()(COUNT|SUM|MAX|MIN|AVG|MD5|STRING_AGG)\s*\(/i.test(sql);

const ROW_NUMBER = /^ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION\s+BY\s+(.+?)\s+ORDER\s+BY\s+(.+?)\s*\)$/i;

export class FakeQueryBuilder {
  private readonly table: Row[];
  private readonly resolveJoin: JoinResolver;
  private readonly predicates: Predicate[] = [];
  private readonly selections: Selection[] = [];
  private readonly groupBys: string[] = [];
  private readonly orders: { sql: string; dir: "ASC" | "DESC" }[] = [];
  private readonly joins: Join[] = [];
  private readonly leftJoinAliases: string[] = [];
  private readonly ctes = new Map<string, string[]>();
  private extraParams: Record<string, unknown> = {};
  private skipN = 0;
  private takeN: number | null = null;
  private source: FakeQueryBuilder | null = null;
  private readonly entityMode: boolean;

  constructor(table: Row[], resolveJoin: JoinResolver = () => ({}), entityMode = false) {
    this.table = table;
    this.resolveJoin = resolveJoin;
    this.entityMode = entityMode;
  }

  select(a: string | string[], b?: string): this {
    if (Array.isArray(a)) return this; // entity-mode projection list keeps full rows
    this.selections.push({ sql: a, alias: b ?? a });
    return this;
  }

  addSelect(a: string | string[], b?: string): this {
    return this.select(a, b);
  }

  where(sql: string, params: Record<string, unknown> = {}): this {
    this.predicates.push({ sql, params });
    return this;
  }

  andWhere(sql: string, params: Record<string, unknown> = {}): this {
    return this.where(sql, params);
  }

  groupBy(sql: string): this {
    this.groupBys.push(sql);
    return this;
  }

  addGroupBy(sql: string): this {
    return this.groupBy(sql);
  }

  orderBy(sql: string, dir: "ASC" | "DESC" = "ASC"): this {
    this.orders.push({ sql, dir });
    return this;
  }

  addOrderBy(sql: string, dir: "ASC" | "DESC" = "ASC"): this {
    return this.orderBy(sql, dir);
  }

  skip(n: number): this {
    this.skipN = n;
    return this;
  }

  take(n: number): this {
    this.takeN = n;
    return this;
  }

  limit(n: number): this {
    this.takeN = n;
    return this;
  }

  offset(n: number): this {
    this.skipN = n;
    return this;
  }

  innerJoin(target: unknown, alias: string, condition?: string): this {
    this.joins.push({ target, alias, condition: condition ?? null });
    return this;
  }

  leftJoin(target: unknown, alias: string, condition?: string): this {
    // Only INNER JOINs participate in the privacy-relevant filtering this fake
    // models; a LEFT JOIN is recorded so an unmodelled one fails loudly rather
    // than silently behaving like an inner join.
    this.joins.push({ target, alias, condition: condition ?? null });
    this.leftJoinAliases.push(alias);
    return this;
  }

  addCommonTableExpression(source: FakeQueryBuilder, name: string): this {
    this.ctes.set(
      name,
      source.compute().map((r) => String(r.client_id))
    );
    return this;
  }

  setParameters(params: Record<string, unknown>): this {
    this.extraParams = { ...this.extraParams, ...params };
    return this;
  }

  getParameters(): Record<string, unknown> {
    return this.predicates.reduce<Record<string, unknown>>((acc, p) => ({ ...acc, ...p.params }), { ...this.extraParams });
  }

  getQuery(): string {
    const token = `__subquery_${subqueryRegistry.size}__`;
    subqueryRegistry.set(token, this);
    return token;
  }

  /** Wraps a previously rendered subquery (see getQuery) and re-filters its rows. */
  from(source: string, alias: string): this {
    // The caller wraps the rendered SQL in parentheses: FROM (<sql>) alias.
    const token = source
      .trim()
      .replace(/^\((.*)\)$/s, "$1")
      .trim();
    const inner = subqueryRegistry.get(token);
    if (!inner) throw new Error(`FakeQueryBuilder: unknown subquery source "${source}" aliased as "${alias}"`);
    this.source = inner;
    return this;
  }

  private value(row: Row, alias: string, column: string): unknown {
    if (this.joins.some((join) => join.alias === alias)) {
      const joined = this.resolveJoin(alias, row);
      return joined ? joined[column] : null;
    }
    return row[column];
  }

  private matches(row: Row, predicate: Predicate): boolean {
    const { sql } = predicate;
    const params = { ...predicate.params, ...this.extraParams };

    const isNull = /^(\w+)\.(\w+)\s+IS NULL$/.exec(sql);
    if (isNull) return this.value(row, isNull[1], isNull[2]) == null;

    const subquery = /^(\w+)\.(\w+)\s+IN\s*\(\s*SELECT\s+(\w+)\.(\w+)\s+FROM\s+(\w+)\s+(\w+)\s*\)$/.exec(sql);
    if (subquery) {
      // `FROM <cte-name> <alias>` — the membership set is keyed by CTE name.
      const members = this.ctes.get(subquery[5]);
      if (!members) throw new Error(`FakeQueryBuilder: unknown CTE "${subquery[5]}" in "${sql}"`);
      return members.includes(String(this.value(row, subquery[1], subquery[2])));
    }

    const inList = /^(\w+)\.(\w+)\s+IN\s*\(\s*:\.\.\.(\w+)\s*\)$/.exec(sql);
    if (inList) {
      const list = params[inList[3]];
      if (!Array.isArray(list)) throw new Error(`FakeQueryBuilder: expected array param :...${inList[3]}`);
      return (list as unknown[]).map(String).includes(String(this.value(row, inList[1], inList[2])));
    }

    const equality = /^(\w+)\.(\w+)\s*=\s*:(\w+)$/.exec(sql);
    if (equality && Array.isArray(params[equality[3]])) {
      return (params[equality[3]] as unknown[]).map(String).includes(String(this.value(row, equality[1], equality[2])));
    }

    const comparison = /^(\w+)\.(\w+)\s*(=|>=|<=|>|<)\s*:(\w+)$/.exec(sql);
    if (comparison) {
      const [, alias, column, op, param] = comparison;
      const left = this.value(row, alias, column);
      const right = params[param];
      if (left == null || right == null) return false;
      if (op === "=") return left === right || (isScalar(left) && isScalar(right) && String(left) === String(right));
      const l = comparable(left);
      const r = comparable(right);
      if (l === null || r === null) return false;
      switch (op) {
        case ">=":
          return l >= r;
        case "<=":
          return l <= r;
        case ">":
          return l > r;
        default:
          return l < r;
      }
    }

    throw new Error(`FakeQueryBuilder: unsupported predicate "${sql}"`);
  }

  /** Applies INNER JOINs + all WHERE predicates. */
  private filtered(): { row: Row; view: Row }[] {
    const base = this.source ? this.source.compute().map((r) => ({ ...r })) : this.table;
    const out: { row: Row; view: Row }[] = [];
    for (const row of base) {
      const view: Row = { ...row };
      let dropped = false;
      for (const join of this.joins) {
        const joined = this.resolveJoin(join.alias, row);
        if (!joined) {
          // INNER JOIN drops the row when the joined side is missing; a LEFT
          // JOIN would keep it with NULLs, which this fake does not model.
          if (this.leftJoinAliases.includes(join.alias)) throw new Error(`FakeQueryBuilder: LEFT JOIN "${join.alias}" is not modelled`);
          dropped = true;
          break;
        }
        view[join.alias] = joined;
      }
      if (dropped) continue;
      if (this.predicates.some((predicate) => !this.matches(view, predicate))) continue;
      out.push({ row, view });
    }
    return out;
  }

  private sort(entries: { row: Row; view: Row }[]): { row: Row; view: Row }[] {
    if (this.orders.length === 0) return entries;
    return entries.slice().sort((a, b) => {
      for (const order of this.orders) {
        const left = this.readOrderValue(a, order.sql);
        const right = this.readOrderValue(b, order.sql);
        if (left === right) continue;
        const l = comparable(left);
        const r = comparable(right);
        if (l === null || r === null) return 0;
        return order.dir === "DESC" ? r - l : l - r;
      }
      return 0;
    });
  }

  private readOrderValue(entry: { row: Row; view: Row }, sql: string): unknown {
    return evaluate(sql, entry.view);
  }

  private paginate<T>(items: T[]): T[] {
    const end = this.takeN === null ? undefined : this.skipN + this.takeN;
    return items.slice(this.skipN, end);
  }

  private aggregateValue(sql: string, group: Row[]): unknown {
    const countDistinct = /^COUNT\(DISTINCT\s+(.+)\)$/i.exec(sql);
    if (countDistinct) return new Set(group.map((r) => String(evaluate(countDistinct[1], r)))).size;
    if (/^COUNT\(\*\)$/i.test(sql)) return group.length;
    const sum = /^COALESCE\(SUM\((.+)\),\s*0\)$/i.exec(sql);
    if (sum) return group.reduce((acc, r) => acc + Number(evaluate(sum[1], r) ?? 0), 0);
    const max = /^MAX\((.+)\)$/i.exec(sql);
    if (max) {
      const values = group.map((r) => evaluate(max[1], r)).filter((v) => v != null) as Date[];
      if (values.length === 0) return null;
      return values.reduce((acc, v) => (v.getTime() > acc.getTime() ? v : acc));
    }
    const md5Agg = /^md5\(string_agg\((.+?),\s*','(?:\s*ORDER BY\s+.+?)?\)\)$/i.exec(sql);
    if (md5Agg) {
      if (group.length === 0) return null;
      return createHash("md5")
        .update(group.map((r) => String(evaluate(md5Agg[1], r))).join(","))
        .digest("hex");
    }
    throw new Error(`FakeQueryBuilder: unsupported aggregate "${sql}"`);
  }

  private applyRowNumbers(projected: Row[], views: Row[]): Row[] {
    const windows = this.selections.map((s) => ({ alias: s.alias, match: ROW_NUMBER.exec(s.sql) })).filter((w): w is { alias: string; match: RegExpExecArray } => w.match !== null);
    if (windows.length === 0) return projected;

    for (const window of windows) {
      const partitionExpr = window.match[1];
      const orderSpec = window.match[2]
        .split(",")
        .map((part) => part.trim())
        .map((part) => {
          const pieces = part.split(/\s+/);
          return { sql: pieces[0], dir: (pieces[1] ?? "ASC").toUpperCase() as "ASC" | "DESC" };
        });

      const partitions = new Map<string, number[]>();
      views.forEach((view, index) => {
        const key = String(evaluate(partitionExpr, view));
        const list = partitions.get(key) ?? [];
        list.push(index);
        partitions.set(key, list);
      });

      for (const indices of partitions.values()) {
        indices
          .slice()
          .sort((i, j) => {
            for (const order of orderSpec) {
              const left = evaluate(order.sql, views[i]);
              const right = evaluate(order.sql, views[j]);
              if (left === right) continue;
              const l = left instanceof Date ? left.getTime() : Number(left);
              const r = right instanceof Date ? right.getTime() : Number(right);
              return order.dir === "DESC" ? r - l : l - r;
            }
            return 0;
          })
          .forEach((rowIndex, position) => {
            projected[rowIndex][window.alias] = position + 1;
          });
      }
    }
    return projected;
  }

  /** Synchronous core, so CTE registration can consume a subquery eagerly. */
  private compute(): Row[] {
    const matched = this.sort(this.filtered());

    if (this.groupBys.length > 0 || this.selections.some((s) => isAggregate(s.sql))) {
      const groups = new Map<string, Row[]>();
      for (const entry of matched) {
        const key = this.groupBys.map((g) => String(this.readGroupKey(g, entry.view))).join("|");
        const list = groups.get(key);
        if (list) list.push(entry.view);
        else groups.set(key, [entry.view]);
      }
      const rows = [...groups.values()].map((group) => {
        const out: Row = {};
        for (const selection of this.selections) {
          out[selection.alias] = isAggregate(selection.sql) ? this.aggregateValue(selection.sql, group) : evaluate(selection.sql, group[0]);
        }
        return out;
      });
      // ORDER BY runs over the projected row, so it may name a select alias
      // (`ORDER BY bucket`) rather than an underlying column.
      return this.sortProjected(rows);
    }

    const views = matched.map((entry) => entry.view);
    const projected: Row[] = matched.map((entry) => {
      const out: Row = {};
      for (const selection of this.selections) {
        if (ROW_NUMBER.test(selection.sql)) continue;
        out[selection.alias] = evaluate(selection.sql, entry.view);
      }
      return out;
    });
    return this.paginate<Row>(this.applyRowNumbers(projected, views));
  }

  /**
   * GROUP BY may reference an output column name (`GROUP BY bucket` for
   * `date_trunc('week', ...) AS bucket`). Resolving such a key against the base
   * row yields `undefined`, which silently collapses every group into one —
   * exactly the kind of wrong-number bug these tests must not tolerate.
   */
  private readGroupKey(sql: string, view: Row): unknown {
    const aliased = this.selections.find((s) => s.alias === sql.trim());
    return aliased ? evaluate(aliased.sql, view) : evaluate(sql, view);
  }

  private sortProjected(rows: Row[]): Row[] {
    if (this.orders.length === 0) return rows;
    return rows.slice().sort((a, b) => {
      for (const order of this.orders) {
        const left: unknown = a[order.sql] ?? evaluate(order.sql, a);
        const right: unknown = b[order.sql] ?? evaluate(order.sql, b);
        if (left === right) continue;
        const bothDates = left instanceof Date && right instanceof Date;
        const cmp = bothDates ? left.getTime() - right.getTime() : Number(left) - Number(right);
        return order.dir === "DESC" ? -cmp : cmp;
      }
      return 0;
    });
  }

  getRawMany<T = Row>(): Promise<T[]> {
    return Promise.resolve(this.compute() as T[]);
  }

  getRawOne<T = Row>(): Promise<T | null> {
    return Promise.resolve((this.compute()[0] as T) ?? null);
  }

  getCount(): Promise<number> {
    return Promise.resolve(this.filtered().length);
  }

  getMany<T = Row>(): Promise<T[]> {
    const matched = this.sort(this.filtered());
    return Promise.resolve(this.paginate<T>(matched.map((entry) => entry.row as T)));
  }

  /** True when this builder was built in entity mode (unused placeholder for symmetry). */
  get isEntityMode(): boolean {
    return this.entityMode;
  }
}

export { DAY_MS, dateKey, subqueryRegistry };
