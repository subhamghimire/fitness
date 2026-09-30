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

/** Per-entity options the social dialect needs and the dashboard does not. */
export interface FakeQueryOptions {
  /** `column_name -> property_name`, for raw fragments that speak SQL names. */
  columns?: Record<string, string>;
  /** Pinned clock for `NOW()`, so a time-decayed score is reproducible. */
  now?: () => Date;
}

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

/* ───────────────────────── SQL expression evaluator ───────────────────────── */

/**
 * Everything above answers a predicate by pattern-matching it against a handful
 * of hand-written shapes. That is enough for the dashboard, but the social
 * services emit genuinely more: a boolean tree for the visibility rule
 * (`post.authorId = :v OR (NOT IN (…) AND (privacy = :a OR …))`), a keyset
 * row-tuple seek (`(post.createdAt, post.id) < (:t, :id)`), and the hotness
 * score expression.
 *
 * Refusing to model those would leave the single most security-relevant thing in
 * the social platform — the predicate that decides who may read a post —
 * untested. So there is a real recursive-descent evaluator for a subset of
 * Postgres expression grammar, used as a *fallback*: the regex fast paths still
 * handle the simple comparisons, and anything they do not recognise is parsed.
 *
 * The parser is deliberately strict. Anything it does not recognise throws, so a
 * query the fake cannot model fails the test rather than quietly returning rows
 * that would make a broken predicate look correct.
 */
interface SqlToken {
  kind: "op" | "ident" | "param" | "number" | "string";
  text: string;
  /** True for `:...name` (a spread parameter). */
  spread?: boolean;
}

const WORD_START = /[A-Za-z_]/;
const WORD_CHAR = /[A-Za-z0-9_$]/;
/** Only timestamp-shaped strings are parsed as instants; a uuid must not be. */
const TIMESTAMP_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const COMPARISON_OPS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);

// The explicit annotation is load-bearing: without it TypeScript will not treat
// a call as unreachable-end, and every `if (!x) sqlFail(...)` after it keeps `x`
// narrowed to `T | undefined` for the rest of the block.
const sqlFail: (message: string) => never = (message) => {
  throw new Error(`FakeQueryBuilder: ${message}`);
};

const tokenizeSql = (sql: string): SqlToken[] => {
  const out: SqlToken[] = [];
  let i = 0;

  const readQuoted = (): string => {
    i++; // opening quote
    let text = "";
    while (i < sql.length && sql[i] !== '"') text += sql[i++];
    if (i >= sql.length) sqlFail(`unterminated quoted identifier in "${sql}"`);
    i++; // closing quote
    return text;
  };

  const readWord = (): string => {
    let text = "";
    while (i < sql.length && WORD_CHAR.test(sql[i])) text += sql[i++];
    return text;
  };

  while (i < sql.length) {
    const ch = sql[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Identifier, possibly `alias.column`, possibly both quoted, optionally cast.
    //
    // The quoting can be *mixed* within one reference — TypeORM emits
    // `"comment"."isDeleted"` because Postgres would otherwise fold the
    // mixed-case column to lower case — so the dot is only a continuation when
    // another part actually follows it. Reading `"block"` and then stopping
    // (because the next character is a quote, not a dot) turns one column into
    // two adjacent tokens, and `x = false` then parses as `x` followed by a
    // dangling `= false` that silently evaluates to "no match" — a predicate that
    // would reject every row and look like a correct soft-delete filter.
    if (ch === '"' || WORD_START.test(ch)) {
      const parts: string[] = [];
      for (;;) {
        if (sql[i] === '"') parts.push(readQuoted());
        else if (i < sql.length && WORD_START.test(sql[i])) parts.push(readWord());
        else sqlFail(`expected an identifier part at offset ${i} of "${sql}"`);
        if (sql[i] !== ".") break;
        i++;
        if (i >= sql.length || (sql[i] !== '"' && !WORD_START.test(sql[i]))) sqlFail(`expected an identifier after "." in "${sql}"`);
      }
      let text = parts.join(".");
      // `col::type` — the cast is irrelevant to the value, but it must be consumed
      // so it is never mistaken for a comparison operator.
      while (sql.startsWith("::", i)) {
        i += 2;
        text += `::${sql[i] === '"' ? readQuoted() : readWord()}`;
      }
      out.push({ kind: "ident", text });
      continue;
    }

    if (ch === "'") {
      i++;
      let text = "";
      while (i < sql.length && sql[i] !== "'") {
        if (sql[i] === "\\" && i + 1 < sql.length) {
          text += sql[i + 1];
          i += 2;
        } else text += sql[i++];
      }
      if (i >= sql.length) sqlFail(`unterminated string literal in "${sql}"`);
      i++;
      out.push({ kind: "string", text });
      continue;
    }

    if (ch === ":") {
      i++;
      const spread = sql.startsWith("...", i);
      if (spread) i += 3;
      const name = readWord();
      if (name === "") sqlFail(`expected a parameter name after ":" in "${sql}"`);
      out.push({ kind: "param", text: name, spread });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let text = "";
      while (i < sql.length && /[0-9.]/.test(sql[i])) text += sql[i++];
      out.push({ kind: "number", text: String(Number(text)) });
      continue;
    }

    const two = sql.slice(i, i + 2);
    if (["<=", ">=", "<>", "!="].includes(two)) {
      out.push({ kind: "op", text: two });
      i += 2;
      continue;
    }
    if ("=<>(),+-*/".includes(ch)) {
      out.push({ kind: "op", text: ch });
      i++;
      continue;
    }
    sqlFail(`unsupported character "${ch}" in "${sql}"`);
  }

  return out;
};

/**
 * Resolves a column reference against an already-joined view.
 *
 * Two things the legacy `readRef` deliberately does not do, both needed by the
 * social dialect: strip the quoting (`"comment"."isDeleted"` arrives quoted
 * because Postgres would otherwise fold the mixed-case column to lower case),
 * and translate a *column* name into the *property* name the fake rows use — the
 * services mix both freely in raw fragments, because an update builder speaks
 * `like_count` while a select builder speaks `likeCount`.
 */
const resolveRef = (row: Row, ref: string, columns?: Record<string, string>): unknown => {
  const text = ref.trim().replace(/::.*$/s, "").replace(/"/g, "");
  const parts = text.split(".");
  const last = parts[parts.length - 1];
  const column = columns?.[last] ?? last;
  if (parts.length >= 2) {
    const joined: unknown = row[parts[parts.length - 2]];
    if (joined !== null && typeof joined === "object") return (joined as Row)[column];
  }
  return row[column];
};

/** Total ordering across mixed timestamp / uuid / numeric sort keys. */
const orderKey = (value: unknown): number | string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" || typeof value === "boolean") return Number(value);
  if (typeof value === "string") return TIMESTAMP_LIKE.test(value) ? Date.parse(value) : value;
  return null;
};

const compareOrder = (a: unknown, b: unknown): number => {
  const left = orderKey(a);
  const right = orderKey(b);
  if (left === null || right === null) return 0;
  if (left === right) return 0;
  if (typeof left === "number" && typeof right === "number") return left < right ? -1 : 1;
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : 1;
  return sqlFail(`cannot order ${typeof a} against ${typeof b}`);
};

/**
 * Text form of a scalar, for the string comparison `=` performs on text columns.
 *
 * A non-scalar here is a harness bug, and stringifying it would compare
 * `[object Object]` to `[object Object]` — which is *true*, so the bug would
 * silently widen a predicate instead of failing it.
 */
const scalarText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return sqlFail(`cannot compare a ${typeof value} value`);
};

/** SQL equality: NULL compares unequal to everything, including another NULL. */
const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (a instanceof Date || b instanceof Date) {
    const left = a instanceof Date ? a.getTime() : Date.parse(String(a));
    const right = b instanceof Date ? b.getTime() : Date.parse(String(b));
    if (!Number.isNaN(left) && !Number.isNaN(right)) return left === right;
  }
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  return scalarText(a) === scalarText(b);
};

/** Postgres truthiness for the three-valued logic the predicates rely on. */
const truthy = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
};

interface EvalContext {
  params: Record<string, unknown>;
  read: (ref: string) => unknown;
  /** Pinned `NOW()`, so a score is reproducible within a test. */
  now: Date;
  ctes: Map<string, string[]>;
}

class SqlExpressionParser {
  private index = 0;

  constructor(
    private readonly tokens: SqlToken[],
    private readonly ctx: EvalContext
  ) {}

  parse(): unknown {
    const value = this.parseOr();
    if (this.index < this.tokens.length) sqlFail(`unexpected trailing tokens in "${this.tokens.map((t) => t.text).join(" ")}"`);
    return value;
  }

  private peek(offset = 0): SqlToken | undefined {
    return this.tokens[this.index + offset];
  }

  private advance(): SqlToken {
    const token = this.tokens[this.index];
    if (!token) sqlFail("unexpected end of expression");
    this.index++;
    return token;
  }

  private isKeyword(token: SqlToken | undefined, word: string): boolean {
    return token?.kind === "ident" && token.text.toLowerCase() === word;
  }

  private expectOp(text: string): void {
    const token = this.advance();
    if (token.kind !== "op" || token.text !== text) sqlFail(`expected "${text}" but found "${token.text}"`);
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.isKeyword(this.peek(), "or")) {
      this.advance();
      const right = this.parseAnd();
      left = truthy(left) || truthy(right);
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseNot();
    while (this.isKeyword(this.peek(), "and")) {
      this.advance();
      const right = this.parseNot();
      left = truthy(left) && truthy(right);
    }
    return left;
  }

  private parseNot(): unknown {
    if (this.isKeyword(this.peek(), "not")) {
      this.advance();
      return !truthy(this.parseNot());
    }
    return this.parseComparison();
  }

  private parseComparison(): unknown {
    const left = this.parseValue();
    const token = this.peek();

    if (this.isKeyword(token, "is")) {
      this.advance();
      const negated = this.isKeyword(this.peek(), "not");
      if (negated) this.advance();
      const target = this.advance();
      if (target.kind !== "ident" || target.text.toLowerCase() !== "null") sqlFail(`expected NULL after IS but found "${target.text}"`);
      return negated ? left !== null && left !== undefined : left === null || left === undefined;
    }

    if (this.isKeyword(token, "in")) {
      this.advance();
      return this.parseInList(left);
    }

    if (this.isKeyword(token, "not") && this.isKeyword(this.peek(1), "in")) {
      this.advance();
      this.advance();
      return !this.parseInList(left);
    }

    if (token?.kind === "op" && COMPARISON_OPS.has(token.text)) {
      this.advance();
      const right = this.parseValue();
      return compareOperands(left, token.text, right);
    }

    return left;
  }

  private parseInList(left: unknown): boolean {
    this.expectOp("(");

    // `x IN (SELECT col FROM <cte> <alias>)`
    if (this.isKeyword(this.peek(), "select")) {
      this.advance();
      this.advance(); // column
      const from = this.advance();
      if (from.kind !== "ident" || from.text.toLowerCase() !== "from") sqlFail("expected FROM in a subquery");
      const cte = this.advance();
      this.advance(); // alias
      this.expectOp(")");
      const members = this.ctx.ctes.get(cte.text);
      if (!members) sqlFail(`unknown CTE "${cte.text}"`);
      return members.includes(String(left));
    }

    const values: unknown[] = [];
    if (this.peek()?.kind !== "op" || this.peek()?.text !== ")") {
      for (;;) {
        const token = this.peek();
        if (token?.kind === "param" && token.spread) {
          this.advance();
          const spread = this.ctx.params[token.text];
          if (!Array.isArray(spread)) sqlFail(`expected an array parameter :...${token.text}`);
          values.push(...(spread as unknown[]));
        } else values.push(this.parseValue());
        if (this.peek()?.kind === "op" && this.peek()?.text === ",") {
          this.advance();
          continue;
        }
        break;
      }
    }
    this.expectOp(")");
    return values.some((value) => valuesEqual(left, value));
  }

  private parseValue(): unknown {
    return this.parseAdditive();
  }

  private parseAdditive(): unknown {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.text !== "+" && token.text !== "-")) break;
      this.advance();
      const right = this.parseMultiplicative();
      left = token.text === "+" ? Number(left) + Number(right) : Number(left) - Number(right);
    }
    return left;
  }

  private parseMultiplicative(): unknown {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.text !== "*" && token.text !== "/")) break;
      this.advance();
      const right = this.parseUnary();
      left = token.text === "*" ? Number(left) * Number(right) : Number(left) / Number(right);
    }
    return left;
  }

  private parseUnary(): unknown {
    const token = this.peek();
    if (token?.kind === "op" && (token.text === "-" || token.text === "+")) {
      this.advance();
      const value = Number(this.parseUnary());
      return token.text === "-" ? -value : value;
    }
    return this.parseAtom();
  }

  private parseAtom(): unknown {
    const token = this.peek();
    if (!token) sqlFail("unexpected end of expression");

    if (token.kind === "number") {
      this.advance();
      return Number(token.text);
    }

    if (token.kind === "string") {
      this.advance();
      return token.text;
    }

    if (token.kind === "param") {
      this.advance();
      if (!(token.text in this.ctx.params)) sqlFail(`no value bound for :${token.text}`);
      return this.ctx.params[token.text];
    }

    if (token.kind === "op" && token.text === "(") {
      const row = this.tryParseTuple();
      if (row) return row;
      this.expectOp("(");
      const inner = this.parseOr();
      this.expectOp(")");
      return inner;
    }

    const word = token.text.toLowerCase();

    if (word === "null") {
      this.advance();
      return null;
    }
    if (word === "true" || word === "false") {
      this.advance();
      return word === "true";
    }
    if (word === "now") {
      this.advance();
      this.expectOp("(");
      this.expectOp(")");
      return this.ctx.now;
    }
    if (word === "extract") {
      this.advance();
      this.expectOp("(");
      const unit = this.advance();
      const from = this.advance();
      if (from.kind !== "ident" || from.text.toLowerCase() !== "from") sqlFail("expected FROM inside EXTRACT");
      const source = this.parseValue();
      this.expectOp(")");
      const unitName = unit.text.toLowerCase();
      if (unitName !== "epoch") sqlFail(`unsupported EXTRACT unit "${unit.text}"`);
      // A `Date` source is an instant; a numeric source is already a millisecond
      // *duration* (e.g. `NOW() - created_at`, which the arithmetic evaluator
      // folds to a number via `Number(Date)`). Treating a duration as an instant
      // would return the creation epoch instead of the age and silently invert
      // the hotness decay, so durations convert directly to seconds.
      if (typeof source === "number") return source / 1000;
      const instant = source instanceof Date ? source.getTime() : Number(source);
      return (this.ctx.now.getTime() - instant) / 1000;
    }

    this.advance();
    const following = this.peek();
    if (following?.kind === "op" && following.text === "(") {
      this.advance();
      let distinct = false;
      if (this.isKeyword(this.peek(), "distinct")) {
        this.advance();
        distinct = true;
      }
      const args: unknown[] = [];
      if (this.peek()?.kind !== "op" || this.peek()?.text !== ")") {
        for (;;) {
          args.push(this.parseValue());
          if (this.peek()?.kind === "op" && this.peek()?.text === ",") {
            this.advance();
            continue;
          }
          break;
        }
      }
      this.expectOp(")");
      return callSqlFunction(token.text.toLowerCase(), args, distinct);
    }

    return this.ctx.read(token.text);
  }

  /**
   * `(a, b)` is only a row tuple if it really has two elements. `(1 = 1)` is a
   * grouped boolean, so the attempt has to be able to back out entirely — hence
   * the saved cursor rather than a speculative token stream.
   */
  private tryParseTuple(): { tuple: true; values: unknown[] } | null {
    const saved = this.index;
    try {
      this.expectOp("(");
      const values: unknown[] = [];
      for (;;) {
        values.push(this.parseValue());
        if (this.peek()?.kind === "op" && this.peek()?.text === ",") {
          this.advance();
          continue;
        }
        break;
      }
      this.expectOp(")");
      if (values.length < 2) {
        this.index = saved;
        return null;
      }
      return { tuple: true, values };
    } catch {
      this.index = saved;
      return null;
    }
  }
}

const callSqlFunction = (name: string, args: unknown[], distinct: boolean): unknown => {
  switch (name) {
    case "greatest":
    case "least": {
      const numbers = args.map(Number).filter((value) => !Number.isNaN(value));
      if (numbers.length === 0) return null;
      const pick = name === "greatest" ? Math.max : Math.min;
      // Postgres ignores NULLs rather than propagating them, which is what keeps
      // the hotness numerator from collapsing to NULL.
      return pick(...numbers);
    }
    case "coalesce":
      return args.find((value) => value !== null && value !== undefined) ?? null;
    case "power":
      return Math.pow(Number(args[0]), Number(args[1]));
    case "abs":
      return Math.abs(Number(args[0]));
    case "floor":
      return Math.floor(Number(args[0]));
    case "ceil":
      return Math.ceil(Number(args[0]));
    case "round":
      return Math.round(Number(args[0]));
    case "length":
      return String(args[0]).length;
    case "count":
      return distinct ? new Set(args.map(String)).size : args.length;
    default:
      return sqlFail(`unsupported function "${name}()"`);
  }
};

/**
 * Row-tuple comparison, lexicographic — the form every keyset seek uses.
 *
 * `(a, b) < (:x, :y)` means "a < x, or a = x and b < y", which is exactly what
 * makes the `id` tiebreaker sound: two rows sharing a `created_at` cannot
 * straddle a page boundary and lose one.
 */
const compareOperands = (left: unknown, op: string, right: unknown): boolean => {
  const leftIsTuple = isRowTuple(left);
  const rightIsTuple = isRowTuple(right);
  if (leftIsTuple || rightIsTuple) {
    if (!leftIsTuple || !rightIsTuple) sqlFail("cannot compare a row tuple with a scalar");
    const l = (left as { tuple: true; values: unknown[] }).values;
    const r = (right as { tuple: true; values: unknown[] }).values;
    if (l.length !== r.length) sqlFail(`row tuple arity mismatch (${l.length} vs ${r.length})`);
    for (let i = 0; i < l.length; i++) {
      if (valuesEqual(l[i], r[i])) continue;
      if (l[i] === null || r[i] === null) return false; // unknown → not true
      const cmp = compareOrder(l[i], r[i]);
      if (op === "<") return cmp < 0;
      if (op === "<=") return cmp <= 0;
      if (op === ">") return cmp > 0;
      if (op === ">=") return cmp >= 0;
      if (op === "=") return false;
      return true;
    }
    return op === "<=" || op === ">=" || op === "=";
  }

  if (op === "=") return valuesEqual(left, right);
  if (op === "<>" || op === "!=") return !valuesEqual(left, right);
  if (left === null || left === undefined || right === null || right === undefined) return false;
  const cmp = compareOrder(left, right);
  if (op === "<") return cmp < 0;
  if (op === "<=") return cmp <= 0;
  if (op === ">") return cmp > 0;
  return cmp >= 0;
};

const isRowTuple = (value: unknown): value is { tuple: true; values: unknown[] } => typeof value === "object" && value !== null && (value as { tuple?: boolean }).tuple === true;

/** Parses and evaluates one SQL fragment against one row. */
const evaluateSql = (sql: string, ctx: EvalContext): unknown => new SqlExpressionParser(tokenizeSql(sql), ctx).parse();

const isAggregate = (sql: string): boolean => /(^|\()(COUNT|SUM|MAX|MIN|AVG|MD5|STRING_AGG)\s*\(/i.test(sql);

const ROW_NUMBER = /^ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION\s+BY\s+(.+?)\s+ORDER\s+BY\s+(.+?)\s*\)$/i;

/**
 * The hand-written shapes, factored out of the select builder so the `UPDATE`
 * fake evaluates a `WHERE` clause with exactly the same rules.
 *
 * `read` receives an `(alias, column)` pair. Returns `null` — meaning "not
 * recognised, fall through to the parser" — rather than guessing, so an
 * unmodelled predicate can never be mistaken for one that does not match.
 */
const fastMatch = (read: (alias: string, column: string) => unknown, sql: string, params: Record<string, unknown>, ctes: Map<string, string[]>): boolean | null => {
  const isNull = /^(\w+)\.(\w+)\s+IS NULL$/.exec(sql);
  if (isNull) return read(isNull[1], isNull[2]) == null;

  const subquery = /^(\w+)\.(\w+)\s+IN\s*\(\s*SELECT\s+(\w+)\.(\w+)\s+FROM\s+(\w+)\s+(\w+)\s*\)$/.exec(sql);
  if (subquery) {
    // `FROM <cte-name> <alias>` — the membership set is keyed by CTE name.
    const members = ctes.get(subquery[5]);
    if (!members) throw new Error(`FakeQueryBuilder: unknown CTE "${subquery[5]}" in "${sql}"`);
    return members.includes(String(read(subquery[1], subquery[2])));
  }

  const inList = /^(\w+)\.(\w+)\s+IN\s*\(\s*:\.\.\.(\w+)\s*\)$/.exec(sql);
  if (inList) {
    const list = params[inList[3]];
    if (!Array.isArray(list)) throw new Error(`FakeQueryBuilder: expected array param :...${inList[3]}`);
    return (list as unknown[]).map(String).includes(String(read(inList[1], inList[2])));
  }

  const equality = /^(\w+)\.(\w+)\s*=\s*:(\w+)$/.exec(sql);
  if (equality && Array.isArray(params[equality[3]])) {
    return (params[equality[3]] as unknown[]).map(String).includes(String(read(equality[1], equality[2])));
  }

  const comparison = /^(\w+)\.(\w+)\s*(=|>=|<=|>|<)\s*:(\w+)$/.exec(sql);
  if (comparison) {
    const [, alias, column, op, param] = comparison;
    const left = read(alias, column);
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

  return null;
};

/**
 * Fragments only the legacy pattern-matcher understands.
 *
 * `to_char`, `date_trunc` and `||` concatenation are dashboard-only spellings the
 * recursive-descent parser deliberately does not model. Dispatching on them
 * explicitly — rather than catching the parser's exception — means a *new*
 * unmodelled shape still throws, instead of being silently evaluated as a
 * column reference that happens to be `undefined`.
 */
const LEGACY_ONLY_FRAGMENT = /\|\||\bto_char\s*\(|\bdate_trunc\s*\(/i;

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
  private readonly columns: Record<string, string> | undefined;
  private readonly now: () => Date;

  constructor(table: Row[], resolveJoin: JoinResolver = () => ({}), entityMode = false, options?: FakeQueryOptions) {
    this.table = table;
    this.resolveJoin = resolveJoin;
    this.entityMode = entityMode;
    this.columns = options?.columns;
    // Reads through `Date.now()` rather than `new Date()` on purpose: a test that
    // pins the clock to pin a decayed score pins *both* halves of it (the SQL
    // side and the application's `cursorKeys`), and only `Date.now` can be pinned
    // without taking the HTTP stack's timers down with it.
    this.now = options?.now ?? (() => new Date(Date.now()));
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
    const params = { ...predicate.params, ...this.extraParams };
    const fast = fastMatch((alias, column) => this.value(row, alias, column), predicate.sql, params, this.ctes);
    if (fast !== null) return fast;

    // Nothing above recognises it, so it is one of the shapes the social
    // services emit: a boolean tree, a keyset row-tuple seek, or a bare
    // quoted/qualified column comparison. Parsed rather than ignored, and
    // thrown (not assumed) if the parser cannot model it either.
    return truthy(this.evalSql(predicate.sql, { row, params }));
  }

  /** Parses one SQL fragment against one row under the builder's context. */
  private evalSql(sql: string, options: { row: Row; params?: Record<string, unknown> }): unknown {
    return evaluateSql(sql, {
      params: options.params ?? {},
      read: (ref) => resolveRef(options.row, ref, this.columns),
      now: this.now(),
      ctes: this.ctes
    });
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
        const cmp = compareOrder(this.readOrderValue(a, order.sql), this.readOrderValue(b, order.sql));
        if (cmp === 0) continue;
        return order.dir === "DESC" ? -cmp : cmp;
      }
      return 0;
    });
  }

  /**
   * Reads an `ORDER BY` key.
   *
   * Two things it must get right, both of which produce plausible-looking but
   * wrong pages when missed:
   *
   *  - **A select alias is a real column.** `ORDER BY feed_score` names the
   *    output column added by `addSelect(<score expression>, "feed_score")`.
   *    Reading it off the base row yields `undefined` for every row, so the
   *    comparator sees a tie and the feed comes back in insertion order —
   *    indistinguishable from a correct result for a monotonic fixture, and
   *    wrong the moment two posts decay differently.
   *  - **uuid sort keys are not dates.** The `id` tiebreaker that makes a
   *    keyset page lossless sorts uuids, and `new Date(uuid).getTime()` is
   *    `NaN`, which silently degrades every comparison to "equal".
   */
  private readOrderValue(entry: { row: Row; view: Row }, sql: string): unknown {
    const aliased = this.selections.find((selection) => selection.alias === sql.trim());
    return this.readFragment(aliased ? aliased.sql : sql, entry.view);
  }

  /** Parses one expression, under the builder's parameters and clock. */
  private readFragment(sql: string, view: Row): unknown {
    return LEGACY_ONLY_FRAGMENT.test(sql) ? evaluate(sql, view) : this.evalSql(sql, { row: view, params: this.getParameters() });
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
    return this.readFragment(aliased ? aliased.sql : sql, view);
  }

  private sortProjected(rows: Row[]): Row[] {
    if (this.orders.length === 0) return rows;
    return rows.slice().sort((a, b) => {
      for (const order of this.orders) {
        const left: unknown = a[order.sql] ?? this.readFragment(order.sql, a);
        const right: unknown = b[order.sql] ?? this.readFragment(order.sql, b);
        const cmp = compareOrder(left, right);
        if (cmp === 0) continue;
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

  /**
   * The first row, or null — `getMany()[0]` with the same filtering and ordering.
   *
   * Exists because "is there a live row matching this predicate?" is the shape
   * several social checks are written in (`isBlockedEitherDirection`), and a
   * fake that only had `getMany` would force those checks to over-fetch or
   * return a boolean the real builder never returns.
   */
  getOne<T = Row>(): Promise<T | null> {
    return this.getMany<T>().then((rows) => rows[0] ?? null);
  }

  /** True when this builder was built in entity mode (unused placeholder for symmetry). */
  get isEntityMode(): boolean {
    return this.entityMode;
  }
}

/**
 * A minimal `UPDATE` fake.
 *
 * The social modules express their soft deletes and counter bumps as
 * conditional single-statement UPDATEs, and the *condition* is the behaviour
 * under test: `LikesService.unlike` decrements the counter only when the
 * soft-delete actually matched a live row, and `PostEngagementService` clamps
 * with `GREATEST(0, …)`. A fake that returned a canned `affected: 1` would
 * happily pass a regression that double-decremented a post on a retry, so this
 * one really filters the rows.
 *
 * `set()` accepts a value *function*, exactly as TypeORM does, so
 * `GREATEST(0, "like_count" + 1)` is evaluated against the row's own current
 * value rather than substituted with a number — which is what makes two
 * concurrent increments both add one instead of one overwriting the other.
 */
export class FakeUpdateQueryBuilder {
  private readonly table: Row[];
  private readonly assignments: Record<string, unknown> = {};
  private readonly predicates: Predicate[] = [];
  private extraParams: Record<string, unknown> = {};
  private readonly columns: Record<string, string> | undefined;
  private readonly now: () => Date;

  constructor(table: Row[], options?: FakeQueryOptions) {
    this.table = table;
    this.columns = options?.columns;
    this.now = options?.now ?? (() => new Date(Date.now()));
  }

  set(values: Record<string, unknown>): this {
    Object.assign(this.assignments, values);
    return this;
  }

  where(sql: string, params: Record<string, unknown> = {}): this {
    this.predicates.push({ sql, params });
    return this;
  }

  andWhere(sql: string, params: Record<string, unknown> = {}): this {
    return this.where(sql, params);
  }

  setParameters(params: Record<string, unknown>): this {
    this.extraParams = { ...this.extraParams, ...params };
    return this;
  }

  private get params(): Record<string, unknown> {
    return this.predicates.reduce<Record<string, unknown>>((acc, p) => ({ ...acc, ...p.params }), { ...this.extraParams });
  }

  /** True when the row satisfies every `WHERE` clause. */
  private matches(row: Row, params: Record<string, unknown>): boolean {
    const read = (alias: string, column: string): unknown => resolveRef(row, `${alias}.${column}`, this.columns);
    return this.predicates.every((predicate) => {
      const fast = fastMatch(read, predicate.sql, params, new Map());
      if (fast !== null) return fast;
      const value = evaluateSql(predicate.sql, {
        params,
        read: (ref) => resolveRef(row, ref, this.columns),
        now: this.now(),
        ctes: new Map()
      });
      return truthy(value);
    });
  }

  /** Applies the assignments to every matching row, in place. */
  execute(): Promise<{ affected: number; raw: Row[]; generatedMaps: Row[] }> {
    const params = this.params;
    const raw: Row[] = [];
    for (const row of this.table) {
      if (!this.matches(row, params)) continue;
      for (const [property, value] of Object.entries(this.assignments)) {
        row[property] =
          typeof value === "function"
            ? evaluateSql(String((value as () => string)()), {
                params,
                read: (ref) => resolveRef(row, ref, this.columns),
                now: this.now(),
                ctes: new Map()
              })
            : value;
      }
      raw.push(row);
    }
    return Promise.resolve({ affected: raw.length, raw, generatedMaps: [] });
  }
}

export { DAY_MS, dateKey, subqueryRegistry };
