# Flat Timeline, Single Page, and Engine Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the visualizer into a single page with a pinned query, one flat timeline whose steps show Before and After together with a concrete sentence, and an engine that matches SQLite for every query a beginner would type.

**Architecture:** The domain layer keeps its parser → AST → engine → `ExecutionStep[]` pipeline. The parser gains string-aware tokenizing (shared `sqlText.ts`), clause-order checks and raw clause text; the engine gains SQLite semantics, concrete step summaries, one `selectGroup` step per group and drops dead metadata. The UI is split from `App.tsx` into `src/ui/` components: a pinned query, a timeline, and a step panel that renders Before/After per step kind. The router, landing page and pagination are removed.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Vitest 4 with jsdom and Testing Library, lz-string for share links.

**Spec:** `docs/superpowers/specs/2026-09-24-flat-timeline-single-page-design.md`

## Global Constraints

- **No per-task commits.** The owner wants the whole branch committed once at the end (Task 11). Every task ends with a green test run instead of a commit.
- Expected SQL behaviour is SQLite's, because the course uses SQLite.
- Tables of 12 rows or fewer render in full; larger tables show 8 rows and one "Show all N rows" link. No Previous / Next controls on any table.
- Columns are qualified (`u.name`) only when the query has two sources.
- Projected rows are numbered `#1`, `#2`, and keep their number through ORDER BY and LIMIT.
- Step sentences use real numbers and names (patterns in spec section 3).
- Starter data, Table SQL entry, and the share-link encoding do not change.
- Palette tokens in `App.css` stay as they are (green accent). HANDOFF must stop saying teal.
- Run `npx vitest run <file>` for a single file and `npm test` for everything. `npm run lint` and `npm run build` must pass before the final commit.

## Review Focus

Inputs the spec implies but no task's tests exercised until they were added below:

1. A share link whose query no longer parses must load the tables, show the error above an empty trace, and not throw. (Test added in Task 10.)
2. Arrow keys pressed while typing in an editor must not move the timeline. (Test added in Task 10.)
3. Applying Table SQL that removes a table the current query uses must show "Unknown table" with the available list and keep the Tables section expanded. (Test added in Task 10.)
4. A cross join producing more than 12 rows must show the "Show all N rows" link in the trace and expand on click. (Test added in Task 7.)
5. `LIMIT` larger than the row count must say nothing was trimmed and keep every row. (Test added in Task 4.)

---

### Task 1: Shared string-aware SQL text helpers

**Files:**
- Create: `src/domain/sqlText.ts`
- Test: `src/domain/sqlText.test.ts`

**Interfaces:**
- Produces:
  - `maskStrings(text: string): string` – same-length copy with every character inside `'…'` or `"…"` replaced by a space (quote characters kept), so regex indexes map back onto `text`.
  - `matchOutsideStrings(text: string, pattern: RegExp): { index: number; text: string; groups: string[] } | undefined` – first match of `pattern` outside strings.
  - `splitOutsideStrings(text: string, separator: RegExp): string[]`
  - `replaceOutsideStrings(text: string, pattern: RegExp, replacer: (match: string) => string): string`
  - `splitTopLevel(text: string, separator?: string): string[]` – splits on `separator` (default `,`) outside strings and outside parentheses; trims parts; drops a trailing empty part.
  - `unquoteString(literal: string): string` – strips one pair of matching quotes and turns `''` into `'` inside single quotes.
  - `isQuotedString(value: string): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/sqlText.test.ts
import { describe, expect, it } from 'vitest'
import {
  isQuotedString,
  maskStrings,
  matchOutsideStrings,
  replaceOutsideStrings,
  splitOutsideStrings,
  splitTopLevel,
  unquoteString,
} from './sqlText'

describe('sqlText', () => {
  it('masks string contents but keeps length and quote characters', () => {
    expect(maskStrings("a = 'FROM' AND b = \"x y\"")).toBe("a = '    ' AND b = \"   \"")
    expect(maskStrings("'it''s'")).toBe("'  '' '")
  })

  it('finds the first match outside strings', () => {
    const match = matchOutsideStrings("fur = 'a = b' AND x >= 2", /(>=|<=|=)/)
    expect(match).toEqual({ index: 4, text: '=', groups: ['='] })
    expect(matchOutsideStrings("name = 'x AS y'", /\s+AS\s+([a-z_]\w*)$/i)).toBeUndefined()
  })

  it('splits outside strings', () => {
    expect(splitOutsideStrings("fur = 'a AND b' AND height > 3", /\s+AND\s+/i)).toEqual(["fur = 'a AND b'", 'height > 3'])
    expect(splitOutsideStrings("SELECT 'x;y'; SELECT 1;", /;/)).toEqual(["SELECT 'x;y'", ' SELECT 1', ''])
  })

  it('replaces outside strings only', () => {
    expect(replaceOutsideStrings("select   'a  b'  from t", /\s+/g, () => ' ')).toBe("select 'a  b' from t")
    expect(replaceOutsideStrings("select 'from' from t", /\bfrom\b/gi, (word) => word.toUpperCase())).toBe("select 'from' FROM t")
  })

  it('splits top-level commas outside parentheses and strings', () => {
    expect(splitTopLevel("a, MAX(b, c), 'd, e', (f + g) * 2")).toEqual(['a', 'MAX(b, c)', "'d, e'", '(f + g) * 2'])
    expect(splitTopLevel('a, b,')).toEqual(['a', 'b'])
  })

  it('unquotes literals and unescapes doubled single quotes', () => {
    expect(unquoteString("'it''s'")).toBe("it's")
    expect(unquoteString('"long"')).toBe('long')
    expect(isQuotedString("'x'")).toBe(true)
    expect(isQuotedString("'a' OR b = 'c'")).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/sqlText.test.ts`
Expected: FAIL – cannot resolve `./sqlText`.

- [ ] **Step 3: Implement the helpers**

```ts
// src/domain/sqlText.ts
export function maskStrings(text: string): string {
  let result = ''
  let quote: string | undefined
  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = undefined
        result += char
      } else {
        result += ' '
      }
      continue
    }
    if (char === "'" || char === '"') quote = char
    result += char
  }
  return result
}

function globalize(pattern: RegExp) {
  return pattern.flags.includes('g') ? pattern : new RegExp(pattern.source, `${pattern.flags}g`)
}

export function matchOutsideStrings(text: string, pattern: RegExp) {
  const match = maskStrings(text).match(new RegExp(pattern.source, pattern.flags.replace('g', '')))
  if (!match || match.index === undefined) return undefined
  return { index: match.index, text: text.slice(match.index, match.index + match[0].length), groups: match.slice(1) }
}

export function splitOutsideStrings(text: string, separator: RegExp): string[] {
  const parts: string[] = []
  let last = 0
  for (const match of maskStrings(text).matchAll(globalize(separator))) {
    parts.push(text.slice(last, match.index))
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return parts
}

export function replaceOutsideStrings(text: string, pattern: RegExp, replacer: (match: string) => string): string {
  let result = ''
  let last = 0
  for (const match of maskStrings(text).matchAll(globalize(pattern))) {
    result += text.slice(last, match.index) + replacer(text.slice(match.index, match.index + match[0].length))
    last = match.index + match[0].length
  }
  return result + text.slice(last)
}

export function splitTopLevel(text: string, separator = ','): string[] {
  const masked = maskStrings(text)
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index]
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === separator && depth === 0) {
      parts.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  const tail = text.slice(start).trim()
  if (tail) parts.push(tail)
  return parts
}

export function isQuotedString(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 2) return false
  const quote = trimmed[0]
  if (quote !== "'" && quote !== '"') return false
  if (trimmed.at(-1) !== quote) return false
  // Masked, a single literal is a quote, then spaces (or doubled single quotes), then a quote.
  const masked = maskStrings(trimmed)
  return quote === "'" ? /^'(?: |'')*'$/.test(masked) : /^" *"$/.test(masked)
}

export function unquoteString(literal: string): string {
  const trimmed = literal.trim()
  const quote = trimmed[0]
  const inner = trimmed.slice(1, -1)
  return quote === "'" ? inner.replaceAll("''", "'") : inner
}
```

Note that `'it''s'` masks to `'  '' '` (7 characters) because the second quote closes and the third reopens. That is what the test expects, and `isQuotedString` allows the `''` pair so the whole thing still counts as one literal.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/sqlText.test.ts`
Expected: PASS (6 tests).

---

### Task 2: Domain types for the new step shape

**Files:**
- Modify: `src/domain/types.ts`

**Interfaces:**
- Produces the types every later task uses. Copy exactly.

- [ ] **Step 1: Replace the changed types**

Edit `src/domain/types.ts` so these definitions replace the existing ones (leave `Scalar`, `Row`, `Table`, `AliasedTable`, `AggregateName`, `ArithmeticOperator`, `Expression`, `SelectItem`, `OrderItem`, `SortSummary` unchanged):

```ts
export type AliasedRow = {
  id: string
  values: Record<string, Scalar>
  /** Ordered result columns; set on projected rows so column order is the order written. */
  columns?: string[]
}

export type JoinedRow = AliasedRow

export type ComparisonOperator = '=' | '!=' | '<>' | '>' | '<' | '>=' | '<=' | 'IS' | 'IS NOT'

export type JoinClause = {
  tableName: string
  alias: string
  conditions: Condition[]
  syntax: 'explicit' | 'comma'
}

/** Raw clause text as the student wrote it (whitespace-normalised), keyword included. */
export type QueryClauses = {
  select: string
  from: string
  join?: string
  where?: string
  groupBy?: string
  having?: string
  orderBy?: string
  limit?: string
}

export type QueryAST = {
  select: SelectItem[]
  from: { tableName: string; alias: string }
  join?: JoinClause
  where: Condition[]
  groupBy: Expression[]
  having: Condition[]
  orderBy: OrderItem[]
  limit?: number
  clauses: QueryClauses
}

export type Group = {
  id: string
  key: string
  rows: AliasedRow[]
  conditions?: Array<{ label: string; result: boolean; value: Scalar; leftLabel: string }>
}

export type Highlight = {
  rowIds?: string[]
  columnKeys?: string[]
  groupIds?: string[]
  kind: 'removed' | 'selected' | 'matched' | 'unmatched'
}

export type StepKind =
  | 'from'
  | 'join'
  | 'where'
  | 'groupBy'
  | 'having'
  | 'select'
  | 'selectGroup'
  | 'orderBy'
  | 'limit'

export type ExecutionStep = {
  id: string
  kind: StepKind
  title: string
  /** One concrete sentence about what this step did, e.g. "Kept 2 of 4 rows where u.tier = 'pro'." */
  summary: string
  /** Text to highlight inside the pinned query. Undefined for the implicit group step. */
  clause?: string
  before?: AliasedRow[] | Group[]
  after: AliasedRow[] | Group[]
  sources?: Array<{ label: string; rows: AliasedRow[] }>
  /** JOIN only: "u1 ↔ l1, l2" match lines. */
  details?: string[]
  highlights: Highlight[]
  sortSummaries?: SortSummary[]
}
```

- [ ] **Step 2: Type-check to see what breaks**

Run: `npx tsc -b --noEmit 2>&1 | head -40`
Expected: errors in `parser.ts`, `engine.ts`, `App.tsx` and tests referencing `explanation`, `condition`, `provenance`, `aggregates`, `keyParts`, `display`, `kind: 'kept'`. Tasks 3, 4 and 7–10 fix them; do not patch them here.

---

### Task 3: Parser: quotes, clause order, IS NULL, parentheses, clause text

**Files:**
- Modify: `src/domain/parser.ts` (full rewrite below)
- Test: `src/domain/parser.test.ts`

**Interfaces:**
- Consumes: `sqlText` helpers from Task 1, types from Task 2.
- Produces: `parseQuery(input: string): QueryAST` with `ast.clauses` filled; `QueryParseError`.

- [ ] **Step 1: Add the failing tests**

Append to `src/domain/parser.test.ts` inside the existing `describe('parseQuery')`:

```ts
  it('records raw clause text for highlighting', () => {
    const ast = parseQuery("select u.name from users u join listening l on u.id = l.user_id where l.minutes > 20 group by u.name having count(*) > 1 order by u.name limit 3")
    expect(ast.clauses).toEqual({
      select: 'select u.name',
      from: 'from users u',
      join: 'join listening l on u.id = l.user_id',
      where: 'where l.minutes > 20',
      groupBy: 'group by u.name',
      having: 'having count(*) > 1',
      orderBy: 'order by u.name',
      limit: 'limit 3',
    })
  })

  it('ignores keywords and AND inside string literals', () => {
    const ast = parseQuery("SELECT name FROM dogs WHERE fur = 'FROM' AND kind = 'a AND b'")
    expect(ast.where.map((condition) => condition.right)).toEqual([
      { type: 'literal', value: 'FROM', label: "'FROM'" },
      { type: 'literal', value: 'a AND b', label: "'a AND b'" },
    ])
  })

  it('unescapes doubled single quotes in literals', () => {
    const ast = parseQuery("SELECT name FROM dogs WHERE name = 'o''neil'")
    expect(ast.where[0].right).toEqual({ type: 'literal', value: "o'neil", label: "'o''neil'" })
  })

  it('enforces clause order', () => {
    expect(() => parseQuery('SELECT name FROM dogs LIMIT 2 ORDER BY name')).toThrow('ORDER BY must come before LIMIT.')
    expect(() => parseQuery('SELECT fur FROM dogs GROUP BY fur WHERE height > 3')).toThrow('WHERE must come before GROUP BY.')
    expect(() => parseQuery('SELECT name FROM dogs WHERE a = 1 WHERE b = 2')).toThrow('WHERE appears more than once.')
  })

  it('parses IS NULL and IS NOT NULL', () => {
    const ast = parseQuery('SELECT name FROM employees WHERE manager_id IS NULL AND name IS NOT NULL')
    expect(ast.where.map((condition) => condition.operator)).toEqual(['IS', 'IS NOT'])
    expect(ast.where[0].right).toEqual({ type: 'literal', value: null, label: 'NULL' })
  })

  it('parses parentheses in arithmetic', () => {
    const ast = parseQuery('SELECT (height + 1) * 2 AS h FROM dogs')
    const expression = ast.select[0].expression
    expect(expression.type).toBe('binary')
    if (expression.type !== 'binary') return
    expect(expression.operator).toBe('*')
    expect(expression.left).toMatchObject({ type: 'binary', operator: '+' })
  })

  it('rejects aggregates in WHERE and nested aggregates with clear messages', () => {
    expect(() => parseQuery('SELECT name FROM dogs WHERE height > AVG(height)')).toThrow(
      "AVG(height) can't be used in WHERE because aggregates need groups. Use HAVING.",
    )
    expect(() => parseQuery('SELECT MAX(COUNT(*)) FROM dogs')).toThrow("Aggregates can't be nested: MAX(COUNT(*)).")
  })

  it('names unsupported operators and OFFSET', () => {
    expect(() => parseQuery("SELECT name FROM dogs WHERE fur IN ('long')")).toThrow('IN is not supported in this visualizer.')
    expect(() => parseQuery('SELECT name FROM dogs WHERE height BETWEEN 1 AND 2')).toThrow('BETWEEN is not supported in this visualizer.')
    expect(() => parseQuery("SELECT name FROM dogs WHERE name LIKE 'a%'")).toThrow('LIKE is not supported in this visualizer.')
    expect(() => parseQuery("SELECT name FROM dogs WHERE NOT fur = 'long'")).toThrow('NOT is not supported in this visualizer.')
    expect(() => parseQuery('SELECT name FROM dogs LIMIT 2 OFFSET 1')).toThrow('OFFSET is not supported in this visualizer.')
  })

  it('keeps ORDER BY integer literals so the engine can sort by position', () => {
    const ast = parseQuery('SELECT name, height FROM dogs ORDER BY 2 DESC')
    expect(ast.orderBy[0].expression).toEqual({ type: 'literal', value: 2, label: '2' })
    expect(ast.orderBy[0].direction).toBe('DESC')
  })
```

Also update the existing test `parses explicit join conditions joined with AND` if it asserts `ast.join?.condition`: it should only assert `conditions`. Any test asserting `ast.join` with `toEqual` must now include `syntax: 'explicit'` and no `condition` key.

- [ ] **Step 2: Run the parser tests to verify the new ones fail**

Run: `npx vitest run src/domain/parser.test.ts`
Expected: the nine new tests FAIL (mostly "clauses" undefined and wrong error messages).

- [ ] **Step 3: Rewrite the parser**

Replace `src/domain/parser.ts` with:

```ts
import { isQuotedString, maskStrings, matchOutsideStrings, replaceOutsideStrings, splitOutsideStrings, splitTopLevel, unquoteString } from './sqlText'
import type {
  AggregateName,
  ArithmeticOperator,
  ComparisonOperator,
  Condition,
  Expression,
  QueryAST,
  QueryClauses,
  SelectItem,
} from './types'

const clauseOrder = ['SELECT', 'FROM', 'JOIN', 'ON', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT'] as const
type ClauseName = (typeof clauseOrder)[number]
type ClauseSpan = { name: ClauseName; start: number; end: number }

const clausePattern = /\b(SELECT|FROM|JOIN|ON|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT)\b/gi
const unsupportedPattern = /\b(DISTINCT|UNION|WITH|OVER|OFFSET|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN|IN|BETWEEN|LIKE|NOT|OR)\b/i
const comparisonPattern = /(>=|<=|<>|!=|=|>|<)/

export class QueryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryParseError'
  }
}

export function parseQuery(input: string): QueryAST {
  const sql = normalize(input)
  if (!sql) throw new QueryParseError('Enter a SELECT query to visualize.')
  if (!/^SELECT\b/i.test(sql)) throw new QueryParseError('Only SELECT queries are supported.')
  rejectUnsupported(sql)

  const spans = collectClauses(sql)
  const textAfter = (name: ClauseName) => {
    const span = spans.find((candidate) => candidate.name === name)
    if (!span) return undefined
    const next = spans.find((candidate) => candidate.start > span.start)
    return sql.slice(span.end, next?.start ?? sql.length).trim()
  }
  const clauseText = (name: ClauseName) => {
    const span = spans.find((candidate) => candidate.name === name)
    if (!span) return undefined
    const next = spans.find((candidate) => candidate.start > span.start)
    return sql.slice(span.start, next?.start ?? sql.length).trim()
  }

  const selectText = textAfter('SELECT')
  const fromText = textAfter('FROM')
  if (!selectText || fromText === undefined) throw new QueryParseError('Queries must include SELECT columns and a FROM table.')

  const fromSources = splitTopLevel(fromText)
  if (fromSources.length === 0) throw new QueryParseError('FROM must name a table.')
  if (fromSources.length > 2) throw new QueryParseError('Only one joined table is supported.')
  const joinText = textAfter('JOIN')
  const onText = textAfter('ON')
  if (fromSources.length > 1 && joinText !== undefined) throw new QueryParseError('Use either comma join syntax or JOIN syntax, not both.')
  const fromSource = parseTableSource(fromSources[0], false)

  let join: QueryAST['join']
  if (fromSources[1]) {
    const commaSource = parseTableSource(fromSources[1], false)
    if (commaSource.alias.toLowerCase() === fromSource.alias.toLowerCase()) throw new QueryParseError('Joined tables must use unique aliases.')
    join = { ...commaSource, conditions: [], syntax: 'comma' }
  }
  if (joinText !== undefined || onText !== undefined) {
    if (joinText === undefined || onText === undefined) throw new QueryParseError('JOIN must use: JOIN table AS alias ON alias.column = alias.column.')
    const joinSource = parseTableSource(joinText, true)
    if (joinSource.alias.toLowerCase() === fromSource.alias.toLowerCase()) throw new QueryParseError('Joined tables must use unique aliases.')
    const conditions = parseConditions(onText)
    rejectAggregates(conditions, 'ON')
    join = { ...joinSource, conditions, syntax: 'explicit' }
  }

  const limitText = textAfter('LIMIT')
  let limit: number | undefined
  if (limitText !== undefined) {
    limit = Number(limitText)
    if (!/^\d+$/.test(limitText) || !Number.isInteger(limit)) throw new QueryParseError('LIMIT must be a non-negative whole number.')
  }

  const where = textAfter('WHERE') !== undefined ? parseConditions(textAfter('WHERE')!) : []
  rejectAggregates(where, 'WHERE')

  const clauses: QueryClauses = {
    select: clauseText('SELECT')!,
    from: clauseText('FROM')!,
    join: joinText !== undefined ? `${clauseText('JOIN')} ${clauseText('ON')}` : undefined,
    where: clauseText('WHERE'),
    groupBy: clauseText('GROUP BY'),
    having: clauseText('HAVING'),
    orderBy: clauseText('ORDER BY'),
    limit: clauseText('LIMIT'),
  }

  return {
    select: splitTopLevel(selectText).map(parseSelectItem),
    from: fromSource,
    join,
    where,
    groupBy: textAfter('GROUP BY') !== undefined ? splitTopLevel(textAfter('GROUP BY')!).map(parseExpression) : [],
    having: textAfter('HAVING') !== undefined ? parseConditions(textAfter('HAVING')!) : [],
    orderBy: textAfter('ORDER BY') !== undefined ? splitTopLevel(textAfter('ORDER BY')!).map(parseOrderItem) : [],
    limit,
    clauses,
  }
}

function normalize(input: string) {
  const trimmed = input.trim().replace(/;\s*$/, '')
  return replaceOutsideStrings(trimmed, /\s+/g, () => ' ').trim()
}

function rejectUnsupported(sql: string) {
  const masked = maskStrings(sql).replace(/\bIS\s+NOT\s+NULL\b/gi, (text) => ' '.repeat(text.length))
  const match = masked.match(unsupportedPattern)
  if (!match) return
  const keyword = match[1].toUpperCase()
  if (keyword === 'OR') throw new QueryParseError('OR is not supported in this visualizer. Combine comparisons with AND.')
  throw new QueryParseError(`${keyword} is not supported in this visualizer.`)
}

function collectClauses(sql: string): ClauseSpan[] {
  const spans: ClauseSpan[] = [...maskStrings(sql).matchAll(clausePattern)].map((match) => ({
    name: match[1].toUpperCase().replace(/\s+/g, ' ') as ClauseName,
    start: match.index,
    end: match.index + match[0].length,
  }))
  const seen = new Set<ClauseName>()
  spans.forEach((span, index) => {
    if (seen.has(span.name)) throw new QueryParseError(`${span.name} appears more than once.`)
    seen.add(span.name)
    const previous = spans[index - 1]
    if (previous && clauseOrder.indexOf(span.name) < clauseOrder.indexOf(previous.name)) {
      throw new QueryParseError(`${span.name} must come before ${previous.name}.`)
    }
  })
  return spans
}

function parseTableSource(text: string, requireAlias: boolean) {
  const match = text.trim().match(/^([a-z_][\w]*)(?:\s+(?:AS\s+)?([a-z_][\w]*))?$/i)
  if (!match) throw new QueryParseError('FROM must use the form: FROM table, FROM table alias, or FROM table AS alias.')
  if (requireAlias && !match[2]) throw new QueryParseError('Joined tables must use the form: table alias or table AS alias.')
  return { tableName: match[1], alias: match[2] ?? match[1] }
}

function parseConditions(text: string): Condition[] {
  return splitOutsideStrings(text, /\s+AND\s+/i).map(parseCondition)
}

function parseCondition(text: string): Condition {
  const trimmed = text.trim()
  const nullCheck = matchOutsideStrings(trimmed, /\s+IS\s+(NOT\s+)?NULL$/i)
  if (nullCheck) {
    return {
      left: parseExpression(trimmed.slice(0, nullCheck.index)),
      operator: nullCheck.groups[0] ? 'IS NOT' : 'IS',
      right: { type: 'literal', value: null, label: 'NULL' },
      label: trimmed,
    }
  }
  const operator = matchOutsideStrings(trimmed, comparisonPattern)
  const left = operator ? trimmed.slice(0, operator.index).trim() : ''
  const right = operator ? trimmed.slice(operator.index + operator.text.length).trim() : ''
  if (!operator || !left || !right) {
    throw new QueryParseError(`Unsupported condition: ${trimmed}. Use a comparison such as column = value, joined with AND.`)
  }
  return {
    left: parseExpression(left),
    operator: operator.text as ComparisonOperator,
    right: parseExpression(right),
    label: trimmed,
  }
}

function rejectAggregates(conditions: Condition[], clause: 'WHERE' | 'ON') {
  for (const condition of conditions) {
    const aggregate = [condition.left, condition.right].flatMap(collectAggregates)[0]
    if (aggregate) throw new QueryParseError(`${aggregate.label} can't be used in ${clause} because aggregates need groups. Use HAVING.`)
  }
}

export function collectAggregates(expression: Expression): Extract<Expression, { type: 'aggregate' }>[] {
  if (expression.type === 'aggregate') return [expression]
  if (expression.type === 'binary') return [...collectAggregates(expression.left), ...collectAggregates(expression.right)]
  return []
}

function parseSelectItem(text: string): SelectItem {
  const trimmed = text.trim()
  const alias = matchOutsideStrings(trimmed, /\s+AS\s+([a-z_][\w]*)$/i)
  const expressionText = alias ? trimmed.slice(0, alias.index) : trimmed
  if (!expressionText.trim()) throw new QueryParseError(`Unsupported SELECT expression: ${trimmed}.`)
  return { expression: parseExpression(expressionText), alias: alias?.groups[0], label: trimmed }
}

function parseOrderItem(text: string) {
  const trimmed = text.trim()
  const direction = matchOutsideStrings(trimmed, /\s+(ASC|DESC)$/i)
  const expressionText = direction ? trimmed.slice(0, direction.index) : trimmed
  return {
    expression: parseExpression(expressionText),
    direction: (direction?.groups[0].toUpperCase() ?? 'ASC') as 'ASC' | 'DESC',
    label: trimmed,
  }
}

function parseExpression(text: string): Expression {
  const value = text.trim()
  if (value === '*') return { type: 'wildcard', label: '*' }
  if (isWrappedInParentheses(value)) return { ...parseExpression(value.slice(1, -1)), label: value }
  const binary = splitBinaryExpression(value)
  if (binary) {
    return {
      type: 'binary',
      operator: binary.operator,
      left: parseExpression(binary.left),
      right: parseExpression(binary.right),
      label: value,
    }
  }
  const aggregate = value.match(/^(COUNT|SUM|AVG|MIN|MAX)\((\*|.+)\)$/i)
  if (aggregate) {
    const fn = aggregate[1].toUpperCase() as AggregateName
    const column = aggregate[2] === '*' ? undefined : parseExpression(aggregate[2])
    if (column && collectAggregates(column).length) throw new QueryParseError(`Aggregates can't be nested: ${value}.`)
    return { type: 'aggregate', fn, column, label: value }
  }
  if (isQuotedString(value)) return { type: 'literal', value: unquoteString(value), label: value }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return { type: 'literal', value: Number(value), label: value }
  if (/^null$/i.test(value)) return { type: 'literal', value: null, label: value }
  const column = value.match(/^(?:(\w+)\.)?(\w+)$/)
  if (column) return { type: 'column', tableAlias: column[1], column: column[2], label: value }
  throw new QueryParseError(`Unsupported expression: ${value}.`)
}

function isWrappedInParentheses(value: string) {
  if (!value.startsWith('(') || !value.endsWith(')')) return false
  const masked = maskStrings(value)
  let depth = 0
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === '(') depth += 1
    if (masked[index] === ')') depth -= 1
    if (depth === 0 && index < masked.length - 1) return false
  }
  return depth === 0
}

function splitBinaryExpression(value: string): { left: string; operator: ArithmeticOperator; right: string } | undefined {
  const masked = maskStrings(value)
  for (const operators of [['+', '-'], ['*', '/']] as const) {
    let depth = 0
    for (let index = masked.length - 1; index >= 0; index -= 1) {
      const char = masked[index]
      if (char === ')') depth += 1
      if (char === '(') depth -= 1
      if (depth === 0 && (operators as readonly string[]).includes(char)) {
        if ((char === '+' || char === '-') && isUnarySign(masked, index)) continue
        const left = value.slice(0, index).trim()
        const right = value.slice(index + 1).trim()
        if (left && right) return { left, operator: char as ArithmeticOperator, right }
      }
    }
  }
  return undefined
}

function isUnarySign(value: string, index: number) {
  return index === 0 || /[+\-*/(]\s*$/.test(value.slice(0, index))
}
```

Note: `parseExpression` for a parenthesised value keeps the outer label (with parentheses) so highlighting and summaries show what the student wrote.

- [ ] **Step 4: Run the parser tests**

Run: `npx vitest run src/domain/parser.test.ts`
Expected: PASS. If the old test `rejects OR with a friendly error` expects the exact old message, the message is unchanged; if a test expected `LIMIT must be a non-negative whole number.` for `OFFSET`, change it to the new OFFSET message.

- [ ] **Step 5: Run the c88c parse-error tests**

Run: `npx vitest run src/domain/c88c.test.ts -t "friendly"`
Expected: the parse-error tests PASS (engine tests in that file still fail until Task 4).

---

### Task 4: Engine: SQLite semantics and the new step shape

**Files:**
- Modify: `src/domain/engine.ts` (full rewrite below)
- Test: `src/domain/engine.test.ts`, `src/domain/c88c.test.ts`

**Interfaces:**
- Consumes: `QueryAST` (with `clauses`) from Task 3, `collectAggregates` exported from the parser, types from Task 2.
- Produces: `executeQuery(ast, tables): ExecutionStep[]`, `QueryExecutionError`, and the exported helper `formatScalar(value: Scalar): string` (used by the UI).

- [ ] **Step 1: Add the failing engine tests**

Append to `src/domain/engine.test.ts` inside `describe('executeQuery')`. The `dogs` fixture already exists in `c88c.test.ts`; here use `initialTables` and inline tables.

```ts
  const emptyish: Table[] = [
    { name: 'dogs', columns: ['name', 'fur', 'height'], rows: [
      { name: 'abraham', fur: 'long', height: 26 },
      { name: 'barack', fur: 'short', height: 52 },
      { name: 'clinton', fur: 'long', height: 47 },
    ] },
  ]

  it('returns one row of aggregates over zero rows', () => {
    const steps = executeQuery(parseQuery("SELECT COUNT(*), SUM(height), AVG(height), MIN(height) FROM dogs WHERE fur = 'none'"), emptyish)
    const rows = steps.at(-1)!.after as AliasedRow[]
    expect(rows).toHaveLength(1)
    expect(rows[0].values).toEqual({ 'COUNT(*)': 0, 'SUM(height)': null, 'AVG(height)': null, 'MIN(height)': null })
  })

  it('returns zero groups when GROUP BY runs over zero rows', () => {
    const steps = executeQuery(parseQuery("SELECT fur, COUNT(*) FROM dogs WHERE fur = 'none' GROUP BY fur"), emptyish)
    expect(steps.at(-1)!.after).toEqual([])
    expect(steps.at(-1)!.kind).toBe('select')
  })

  it('COUNT(column) ignores NULL while COUNT(*) counts rows', () => {
    const rows = rowsFor('SELECT COUNT(manager_id) AS managed, COUNT(*) AS total FROM employees') as AliasedRow[]
    expect(rows[0].values).toEqual({ managed: 3, total: 4 })
  })

  it('treats comparisons with NULL as false and supports IS NULL', () => {
    expect((rowsFor('SELECT name FROM employees WHERE manager_id = NULL') as AliasedRow[])).toHaveLength(0)
    expect((rowsFor('SELECT name FROM employees WHERE manager_id != 1') as AliasedRow[]).map((row) => row.values.name)).toEqual(['Noor'])
    expect((rowsFor('SELECT name FROM employees WHERE manager_id IS NULL') as AliasedRow[]).map((row) => row.values.name)).toEqual(['Priya'])
    expect((rowsFor('SELECT name FROM employees WHERE manager_id IS NOT NULL') as AliasedRow[])).toHaveLength(3)
  })

  it('takes bare columns from the MAX or MIN row like SQLite', () => {
    expect((rowsFor('SELECT name, MAX(salary) FROM employees') as AliasedRow[])[0].values).toEqual({ name: 'Priya', 'MAX(salary)': 150000 })
    expect((rowsFor('SELECT name, MIN(salary) FROM employees') as AliasedRow[])[0].values).toEqual({ name: 'Noor', 'MIN(salary)': 91000 })
    expect((rowsFor('SELECT department, name, MAX(salary) FROM employees GROUP BY department') as AliasedRow[]).map((row) => row.values.name)).toEqual(['Priya', 'Iris'])
  })

  it('sorts by ORDER BY position', () => {
    const rows = rowsFor('SELECT name, salary FROM employees ORDER BY 2 DESC') as AliasedRow[]
    expect(rows.map((row) => row.values.name)).toEqual(['Priya', 'Iris', 'Mateo', 'Noor'])
    expect(() => rowsFor('SELECT name FROM employees ORDER BY 3')).toThrow('ORDER BY 3 is out of range: the result has 1 column(s).')
  })

  it('compares numbers and numeric strings consistently for every operator', () => {
    const tables: Table[] = [{ name: 't', columns: ['a'], rows: [{ a: '10' }, { a: 9 }, { a: 'abc' }] }]
    const rows = (sql: string) => (executeQuery(parseQuery(sql), tables).at(-1)!.after as AliasedRow[]).map((row) => row.values.a)
    expect(rows("SELECT a FROM t WHERE a = '9'")).toEqual([9])
    // Like SQLite, text sorts after every number, so 'abc' >= 10 is true.
    expect(rows('SELECT a FROM t WHERE a >= 10')).toEqual(['10', 'abc'])
    expect(rows('SELECT a FROM t ORDER BY a')).toEqual([9, '10', 'abc'])
  })

  it('matches column and table names case-insensitively', () => {
    const rows = rowsFor('SELECT NAME FROM EMPLOYEES WHERE Department = "ops"') as AliasedRow[]
    expect(rows.map((row) => row.values.NAME)).toEqual(['Priya', 'Mateo'])
  })

  it('resolves SELECT aliases in GROUP BY, HAVING and ORDER BY', () => {
    const rows = rowsFor('SELECT department AS dept, COUNT(*) AS n FROM employees GROUP BY dept HAVING n > 1 ORDER BY n DESC, dept') as AliasedRow[]
    // Both departments have 2 people, so the tie on n falls through to dept ascending.
    expect(rows.map((row) => row.values)).toEqual([{ dept: 'data', n: 2 }, { dept: 'ops', n: 2 }])
  })

  it('keeps result columns in the order written', () => {
    const rows = rowsFor("SELECT name, 1 AS one, 'x' FROM employees LIMIT 1") as AliasedRow[]
    expect(rows[0].columns).toEqual(['name', 'one', "'x'"])
  })

  it('uses bare headers for single-source queries and qualified keys only with two sources', () => {
    const single = executeQuery(parseQuery('SELECT u.name FROM users AS u'), initialTables)
    expect(Object.keys((single[0].after as AliasedRow[])[0].values)).toEqual(['id', 'name', 'tier', 'region'])
    expect((single.at(-1)!.after as AliasedRow[])[0].values).toEqual({ name: 'Ada' })

    const joined = executeQuery(parseQuery('SELECT u.name, l.artist FROM users AS u JOIN listening AS l ON u.id = l.user_id'), initialTables)
    expect(Object.keys((joined[0].after as AliasedRow[])[0].values)).toEqual(['u.id', 'u.name', 'u.tier', 'u.region'])
    expect((joined.at(-1)!.after as AliasedRow[])[0].values).toEqual({ name: 'Ada', artist: 'Nina Simone' })
  })

  it('keeps qualified headers when two selected columns would collide', () => {
    const rows = rowsFor('SELECT a.name, b.name FROM employees AS a JOIN employees AS b ON a.manager_id = b.id') as AliasedRow[]
    expect(rows[0].columns).toEqual(['a.name', 'b.name'])
  })

  it('numbers projected rows and keeps the numbers through ORDER BY and LIMIT', () => {
    const steps = executeQuery(parseQuery('SELECT name FROM employees ORDER BY name DESC LIMIT 2'), initialTables)
    const orderStep = steps.find((step) => step.kind === 'orderBy')!
    expect((orderStep.before as AliasedRow[]).map((row) => row.id)).toEqual(['#1', '#2', '#3', '#4'])
    expect((orderStep.after as AliasedRow[]).map((row) => row.id)).toEqual(['#1', '#4', '#2', '#3'])
    expect(orderStep.sortSummaries?.map((summary) => [summary.rowId, summary.beforeRank, summary.afterRank])).toEqual([
      ['#1', 1, 1], ['#4', 4, 2], ['#2', 2, 3], ['#3', 3, 4],
    ])
    expect((steps.at(-1)!.after as AliasedRow[]).map((row) => row.id)).toEqual(['#1', '#4'])
  })

  it('emits one selectGroup step per group and no result step', () => {
    const steps = executeQuery(parseQuery('SELECT u.region, COUNT(*) AS n FROM users AS u GROUP BY u.region'), initialTables)
    expect(steps.map((step) => step.kind)).toEqual(['from', 'groupBy', 'selectGroup', 'selectGroup'])
    expect(steps[2].summary).toBe('Collapsed group region = west (2 rows) into one result row (1 of 2).')
    expect((steps[2].before as Group[]).map((group) => group.key)).toEqual(['region = west'])
    expect((steps[2].after as AliasedRow[]).map((row) => row.id)).toEqual(['#1'])
    expect((steps[3].after as AliasedRow[]).map((row) => row.id)).toEqual(['#1', '#2'])
    expect(steps[3].highlights).toContainEqual({ kind: 'matched', rowIds: ['#2'] })
  })

  it('writes concrete summaries for each step kind', () => {
    const steps = executeQuery(parseQuery("SELECT u.name FROM users AS u JOIN listening AS l ON u.id = l.user_id WHERE l.minutes > 30 ORDER BY u.name DESC LIMIT 5"), initialTables)
    expect(steps.map((step) => step.summary)).toEqual([
      'Start with all 4 rows of users (as u).',
      'Paired 5 of the 4 × 5 possible combinations where u.id = l.user_id.',
      'Kept 3 of 5 rows where l.minutes > 30.',
      'Kept only the columns you asked for: name.',
      'Sorted 3 rows by u.name (highest first).',
      'Nothing trimmed: 3 rows, limit is 5.',
    ])
    expect(steps[1].details).toEqual(['u1 ↔ l1, l2', 'u2 ↔ l3', 'u3 ↔ l4', 'u4 ↔ l5'])
    expect(steps[1].clause).toBe('JOIN listening AS l ON u.id = l.user_id')
  })

  it('marks unmatched join rows and names them in the summary', () => {
    const tables: Table[] = [
      { name: 'a', columns: ['id'], rows: [{ id: 1 }, { id: 2 }] },
      { name: 'b', columns: ['a_id'], rows: [{ a_id: 1 }, { a_id: 9 }] },
    ]
    const step = executeQuery(parseQuery('SELECT * FROM a AS x JOIN b AS y ON x.id = y.a_id'), tables)[1]
    expect(step.summary).toBe('Paired 1 of the 2 × 2 possible combinations where x.id = y.a_id. x2, y2 had no match.')
    expect(step.highlights).toContainEqual({ kind: 'unmatched', rowIds: ['x2', 'y2'] })
    expect(step.highlights).toContainEqual({ kind: 'selected', columnKeys: ['x.id', 'y.a_id'] })
  })

  it('describes comma joins, implicit groups, HAVING and LIMIT trimming', () => {
    const steps = executeQuery(parseQuery('SELECT COUNT(*) FROM users, listening HAVING COUNT(*) > 1 LIMIT 0'), initialTables)
    expect(steps.map((step) => [step.kind, step.summary])).toEqual([
      ['from', 'Start with all 4 rows of users and all 5 rows of listening.'],
      ['join', 'Paired every row of users with every row of listening: 4 × 5 = 20 pairs.'],
      ['groupBy', 'No GROUP BY, so all 20 rows form one group for the aggregates.'],
      ['having', 'Kept 1 of 1 group where COUNT(*) > 1.'],
      ['selectGroup', 'Collapsed group all rows (20 rows) into one result row (1 of 1).'],
      ['limit', 'Kept the first 0 of 1 row.'],
    ])
    expect(steps[2].clause).toBeUndefined()
  })
```

Then update the existing tests that the new shape breaks:
- Any assertion on `step.explanation` → assert `step.summary` with the new sentence (patterns above).
- Any assertion on `provenance`, `aggregates`, `keyParts`, `values.Group`, or `kind: 'kept'` / `'grouped'` highlights → delete the assertion.
- Any `steps.at(-1)!.title === 'Result'` → remove.
- Row-value lookups like `row.values['u.name']` on final rows of single-source queries become `row.values.name`; on joined queries the final headers are bare unless they collide (`row.values.name`, `row.values.artist`). Intermediate steps in joined queries keep `u.name`.
- The self-join test that expected `['m1.name > m2.name']` in `details` should now check `summary` starts with `Kept`.
- In `c88c.test.ts`, the same rules apply: `rowsFor` still returns the last step's rows; column keys become bare names for single-source queries.

- [ ] **Step 2: Run the engine tests to verify the new ones fail**

Run: `npx vitest run src/domain/engine.test.ts`
Expected: new tests FAIL (type errors on `summary`, wrong keys, wrong values).

- [ ] **Step 3: Rewrite the engine**

Replace `src/domain/engine.ts` with:

```ts
import { collectAggregates } from './parser'
import type {
  AliasedRow,
  Condition,
  ExecutionStep,
  Expression,
  Group,
  OrderItem,
  QueryAST,
  Scalar,
  SelectItem,
  SortSummary,
  Table,
} from './types'

export class QueryExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryExecutionError'
  }
}

type Scope = { qualified: boolean; aliases: string[] }
type Context = { row?: AliasedRow; group?: Group }
type AliasMap = Map<string, Expression>

export function formatScalar(value: Scalar | undefined) {
  return value === null || value === undefined ? '' : String(value)
}

export function executeQuery(ast: QueryAST, tables: Table[]): ExecutionStep[] {
  const steps: ExecutionStep[] = []
  const scope: Scope = { qualified: Boolean(ast.join), aliases: [ast.from.alias, ...(ast.join ? [ast.join.alias] : [])] }
  const aliasMap = selectAliasMap(ast.select)
  const fromTable = requireTable(tables, ast.from.tableName)
  const joinTable = ast.join ? requireTable(tables, ast.join.tableName) : undefined
  const isComma = ast.join?.syntax === 'comma'
  let rows = aliasRows(fromTable, ast.from.alias, scope)
  const rightRows = ast.join && joinTable ? aliasRows(joinTable, ast.join.alias, scope) : []

  const fromLabel = sourceLabel(fromTable, ast.from.alias)
  const rightLabel = ast.join && joinTable ? sourceLabel(joinTable, ast.join.alias) : ''
  steps.push({
    id: 'from',
    kind: 'from',
    title: 'FROM',
    clause: ast.clauses.from,
    summary: isComma
      ? `Start with all ${count(rows.length, 'row')} of ${fromLabel} and all ${count(rightRows.length, 'row')} of ${rightLabel}.`
      : `Start with all ${count(rows.length, 'row')} of ${fromLabel}.`,
    after: rows,
    sources: [{ label: fromLabel, rows }, ...(isComma ? [{ label: rightLabel, rows: rightRows }] : [])],
    highlights: [],
  })

  if (ast.join && joinTable) {
    const before = rows
    const paired: AliasedRow[] = []
    const leftMatches = new Map<string, string[]>()
    const matchedRight = new Set<string>()
    for (const left of before) {
      for (const right of rightRows) {
        const candidate = mergeRows(left, right)
        if (ast.join.conditions.every((condition) => evaluateCondition(condition, { row: candidate }, scope))) {
          paired.push(candidate)
          leftMatches.set(left.id, [...(leftMatches.get(left.id) ?? []), right.id])
          matchedRight.add(right.id)
        }
      }
    }
    rows = paired
    const unmatched = [
      ...before.filter((row) => !leftMatches.has(row.id)),
      ...rightRows.filter((row) => !matchedRight.has(row.id)),
    ].map((row) => row.id)
    const conditionLabel = ast.join.conditions.map((condition) => condition.label).join(' AND ')
    const pairs = `${before.length} × ${rightRows.length}`
    steps.push({
      id: 'join',
      kind: 'join',
      title: isComma ? 'Cross join' : 'JOIN',
      clause: isComma ? ast.clauses.from : ast.clauses.join,
      summary: isComma
        ? `Paired every row of ${ast.from.alias} with every row of ${ast.join.alias}: ${pairs} = ${before.length * rightRows.length} pairs.`
        : `Paired ${paired.length} of the ${pairs} possible combinations where ${conditionLabel}.${unmatched.length ? ` ${unmatched.join(', ')} had no match.` : ''}`,
      before,
      after: rows,
      sources: [
        { label: fromLabel, rows: before },
        { label: rightLabel, rows: rightRows },
      ],
      details: isComma ? undefined : [...leftMatches].map(([leftId, rightIds]) => `${leftId} ↔ ${rightIds.join(', ')}`),
      highlights: isComma
        ? []
        : [
            { kind: 'selected', columnKeys: ast.join.conditions.flatMap((condition) => conditionColumnKeys(condition, aliasMap)) },
            { kind: 'unmatched', rowIds: unmatched },
          ],
    })
  }

  ast.where.forEach((condition, index) => {
    const before = rows
    rows = before.filter((row) => evaluateCondition(condition, { row }, scope))
    steps.push({
      id: ast.where.length === 1 ? 'where' : `where-${index + 1}`,
      kind: 'where',
      title: 'WHERE',
      clause: ast.where.length === 1 ? ast.clauses.where : condition.label,
      summary: `Kept ${rows.length} of ${count(before.length, 'row')} where ${condition.label}.`,
      before,
      after: rows,
      highlights: [
        { kind: 'selected', columnKeys: conditionColumnKeys(condition, aliasMap) },
        { kind: 'removed', rowIds: before.filter((row) => !rows.includes(row)).map((row) => row.id) },
      ],
    })
  })

  const needsGroups =
    ast.groupBy.length > 0 ||
    ast.having.length > 0 ||
    ast.select.some((item) => collectAggregates(item.expression).length > 0) ||
    ast.orderBy.some((item) => collectAggregates(item.expression).length > 0)

  let groups: Group[] | undefined
  if (needsGroups) {
    const groupExpressions = ast.groupBy.map((expression) => resolveAlias(expression, aliasMap))
    groups = groupRows(rows, groupExpressions, ast.groupBy, scope)
    const labels = ast.groupBy.map((expression) => expression.label).join(', ')
    steps.push({
      id: 'group',
      kind: 'groupBy',
      title: 'GROUP BY',
      clause: ast.groupBy.length ? ast.clauses.groupBy : undefined,
      summary: ast.groupBy.length
        ? `Split ${count(rows.length, 'row')} into ${count(groups.length, 'group')} by ${labels}.`
        : `No GROUP BY, so all ${count(rows.length, 'row')} form one group for the aggregates.`,
      before: rows,
      after: groups,
      highlights: [{ kind: 'selected', columnKeys: groupExpressions.flatMap(columnKeys) }],
    })
  }

  if (groups && ast.having.length) {
    const resolved = ast.having.map((condition) => resolveConditionAliases(condition, aliasMap))
    const before: Group[] = groups.map((group) => {
      const context: Context = { row: bareRow(group, ast.select, scope), group }
      return {
        ...group,
        conditions: resolved.map((condition, index) => ({
          label: ast.having[index].label,
          result: evaluateCondition(condition, context, scope),
          value: evaluateExpression(condition.left, context, scope),
          leftLabel: ast.having[index].left.label,
        })),
      }
    })
    groups = before.filter((group) => group.conditions!.every((condition) => condition.result))
    const label = ast.having.map((condition) => condition.label).join(' AND ')
    steps.push({
      id: 'having',
      kind: 'having',
      title: 'HAVING',
      clause: ast.clauses.having,
      summary: `Kept ${groups.length} of ${count(before.length, 'group')} where ${label}.`,
      before,
      after: groups,
      highlights: [{ kind: 'removed', groupIds: before.filter((group) => !groups!.includes(group)).map((group) => group.id) }],
    })
  }

  const headers = resultHeaders(ast.select, scope)
  const selectColumnKeys = ast.select.flatMap((item) => columnKeys(resolveAlias(item.expression, aliasMap)))
  let contexts: Context[]
  if (groups) {
    contexts = groups.map((group) => ({ row: bareRow(group, ast.select, scope), group }))
    const projected = contexts.map((context, index) => project(ast.select, headers, context, index, scope))
    if (!groups.length) {
      steps.push({
        id: 'select',
        kind: 'select',
        title: 'SELECT',
        clause: ast.clauses.select,
        summary: 'No groups remain, so the result is empty.',
        before: [],
        after: [],
        highlights: [],
      })
    }
    groups.forEach((group, index) => {
      steps.push({
        id: `select-${index + 1}`,
        kind: 'selectGroup',
        title: 'SELECT',
        clause: ast.clauses.select,
        summary: `Collapsed group ${group.key} (${count(group.rows.length, 'row')}) into one result row (${index + 1} of ${groups!.length}).`,
        before: [group],
        after: projected.slice(0, index + 1),
        highlights: [
          { kind: 'selected', columnKeys: selectColumnKeys },
          { kind: 'matched', rowIds: [projected[index].id] },
        ],
      })
    })
    rows = projected
  } else {
    contexts = rows.map((row) => ({ row }))
    const before = rows
    rows = contexts.map((context, index) => project(ast.select, headers, context, index, scope))
    const shown = rows[0]?.columns ?? headers.filter((header): header is string => header !== undefined)
    steps.push({
      id: 'select',
      kind: 'select',
      title: 'SELECT',
      clause: ast.clauses.select,
      summary: ast.select.some((item) => item.expression.type === 'wildcard')
        ? `Kept every column (*)${shown.length ? `: ${shown.join(', ')}` : ''}.`
        : `Kept only the columns you asked for: ${shown.join(', ')}.`,
      before,
      after: rows,
      highlights: [{ kind: 'selected', columnKeys: selectColumnKeys }],
    })
  }

  if (ast.orderBy.length) {
    const before = rows
    const sorted = sortRows(rows, contexts, ast.orderBy, aliasMap, scope)
    rows = sorted.map((item) => item.row)
    const description = ast.orderBy
      .map((item) => `${item.expression.label} (${item.direction === 'DESC' ? 'highest first' : 'lowest first'})`)
      .join(', then ')
    steps.push({
      id: 'order-by',
      kind: 'orderBy',
      title: 'ORDER BY',
      clause: ast.clauses.orderBy,
      summary: `Sorted ${count(before.length, 'row')} by ${description}.`,
      before,
      after: rows,
      highlights: [{ kind: 'selected', columnKeys: ast.orderBy.flatMap((item) => [...columnKeys(item.expression), ...columnKeys(resolveAlias(item.expression, aliasMap))]) }],
      sortSummaries: sorted.map((item, index) => toSortSummary(item, ast.orderBy, index)),
    })
  }

  if (ast.limit !== undefined) {
    const before = rows
    rows = rows.slice(0, ast.limit)
    const trimmed = before.length - rows.length
    steps.push({
      id: 'limit',
      kind: 'limit',
      title: 'LIMIT',
      clause: ast.clauses.limit,
      summary: trimmed > 0
        ? `Kept the first ${ast.limit} of ${count(before.length, 'row')}.`
        : `Nothing trimmed: ${count(before.length, 'row')}, limit is ${ast.limit}.`,
      before,
      after: rows,
      highlights: [{ kind: 'removed', rowIds: before.slice(ast.limit).map((row) => row.id) }],
    })
  }

  return steps
}

function count(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function requireTable(tables: Table[], name: string) {
  const table = tables.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())
  if (!table) throw new QueryExecutionError(`Unknown table "${name}". Available tables: ${tables.map((item) => item.name).join(', ')}.`)
  return table
}

function sourceLabel(table: Table, alias: string) {
  return alias.toLowerCase() === table.name.toLowerCase() ? table.name : `${table.name} (as ${alias})`
}

function aliasRows(table: Table, alias: string, scope: Scope): AliasedRow[] {
  return table.rows.map((row, index) => ({
    id: `${alias}${index + 1}`,
    values: Object.fromEntries(table.columns.map((column) => [scope.qualified ? `${alias}.${column}` : column, row[column] ?? null])),
  }))
}

function mergeRows(left: AliasedRow, right: AliasedRow): AliasedRow {
  return { id: `${left.id}+${right.id}`, values: { ...left.values, ...right.values } }
}

function selectAliasMap(select: SelectItem[]): AliasMap {
  const map: AliasMap = new Map()
  for (const item of select) if (item.alias) map.set(item.alias.toLowerCase(), item.expression)
  return map
}

function resolveAlias(expression: Expression, aliasMap: AliasMap): Expression {
  if (expression.type === 'column' && !expression.tableAlias) {
    const target = aliasMap.get(expression.column.toLowerCase())
    if (target) return target
  }
  if (expression.type === 'binary') {
    return { ...expression, left: resolveAlias(expression.left, aliasMap), right: resolveAlias(expression.right, aliasMap) }
  }
  return expression
}

function resolveConditionAliases(condition: Condition, aliasMap: AliasMap): Condition {
  return { ...condition, left: resolveAlias(condition.left, aliasMap), right: resolveAlias(condition.right, aliasMap) }
}

function evaluateCondition(condition: Condition, context: Context, scope: Scope): boolean {
  const left = evaluateExpression(condition.left, context, scope)
  if (condition.operator === 'IS') return left === null
  if (condition.operator === 'IS NOT') return left !== null
  const right = evaluateExpression(condition.right, context, scope)
  if (left === null || right === null) return false
  const comparison = compareScalars(left, right)
  switch (condition.operator) {
    case '=':
      return comparison === 0
    case '!=':
    case '<>':
      return comparison !== 0
    case '>':
      return comparison > 0
    case '<':
      return comparison < 0
    case '>=':
      return comparison >= 0
    case '<=':
      return comparison <= 0
  }
}

function toNumber(value: Scalar): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return undefined
}

export function compareScalars(left: Scalar, right: Scalar) {
  if (left === null && right === null) return 0
  if (left === null) return -1
  if (right === null) return 1
  const leftNumber = toNumber(left)
  const rightNumber = toNumber(right)
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber
  if (leftNumber !== undefined) return -1
  if (rightNumber !== undefined) return 1
  return String(left).localeCompare(String(right))
}

function evaluateExpression(expression: Expression, context: Context, scope: Scope): Scalar {
  if (expression.type === 'literal') return expression.value
  if (expression.type === 'wildcard') throw new QueryExecutionError('SELECT * can only be used as a projection.')
  if (expression.type === 'column') return context.row ? readColumn(context.row, expression, scope) : null
  if (expression.type === 'binary') return evaluateBinary(expression, context, scope)
  const rows = context.group?.rows ?? (context.row ? [context.row] : [])
  if (expression.fn === 'COUNT') {
    if (!expression.column) return rows.length
    return rows.filter((row) => evaluateExpression(expression.column!, { row }, scope) !== null).length
  }
  const values = rows.map((row) => evaluateExpression(expression.column!, { row }, scope)).filter((value) => value !== null)
  if (!values.length) return null
  if (expression.fn === 'SUM' || expression.fn === 'AVG') {
    const numbers = values.map(toNumber).filter((value): value is number => value !== undefined)
    if (!numbers.length) return null
    const total = numbers.reduce((sum, value) => sum + value, 0)
    return expression.fn === 'SUM' ? total : total / numbers.length
  }
  const sorted = [...values].sort(compareScalars)
  return expression.fn === 'MIN' ? sorted[0] : sorted.at(-1)!
}

function evaluateBinary(expression: Extract<Expression, { type: 'binary' }>, context: Context, scope: Scope): Scalar {
  const left = evaluateExpression(expression.left, context, scope)
  const right = evaluateExpression(expression.right, context, scope)
  if (left === null || right === null) return null
  const leftNumber = toNumber(left)
  const rightNumber = toNumber(right)
  if (leftNumber === undefined || rightNumber === undefined) {
    throw new QueryExecutionError(`Arithmetic expression "${expression.label}" must use numeric values.`)
  }
  if (expression.operator === '+') return leftNumber + rightNumber
  if (expression.operator === '-') return leftNumber - rightNumber
  if (expression.operator === '*') return leftNumber * rightNumber
  if (rightNumber === 0) throw new QueryExecutionError(`Arithmetic expression "${expression.label}" divides by zero.`)
  return leftNumber / rightNumber
}

function readColumn(row: AliasedRow, expression: Extract<Expression, { type: 'column' }>, scope: Scope): Scalar {
  const keys = Object.keys(row.values)
  const wantedColumn = expression.column.toLowerCase()
  if (expression.tableAlias) {
    const alias = scope.aliases.find((candidate) => candidate.toLowerCase() === expression.tableAlias!.toLowerCase())
    if (!alias) throw new QueryExecutionError(`Unknown table alias "${expression.tableAlias}". Available: ${scope.aliases.join(', ')}.`)
    const wanted = scope.qualified ? `${alias}.${expression.column}`.toLowerCase() : wantedColumn
    const key = keys.find((candidate) => candidate.toLowerCase() === wanted)
    if (key === undefined) throw new QueryExecutionError(`Unknown column "${expression.tableAlias}.${expression.column}".`)
    return row.values[key]
  }
  const matches = keys.filter((key) => bareName(key, scope).toLowerCase() === wantedColumn)
  if (!matches.length) throw new QueryExecutionError(`Unknown column "${expression.column}".`)
  if (matches.length > 1) throw new QueryExecutionError(`Column "${expression.column}" is ambiguous. Qualify it with a table alias.`)
  return row.values[matches[0]]
}

function bareName(key: string, scope: Scope) {
  return scope.qualified && key.includes('.') ? key.slice(key.indexOf('.') + 1) : key
}

function groupRows(rows: AliasedRow[], expressions: Expression[], originals: Expression[], scope: Scope): Group[] {
  if (!expressions.length) {
    return [{ id: 'group-1', key: 'all rows', rows }]
  }
  const buckets = new Map<string, AliasedRow[]>()
  for (const row of rows) {
    const key = expressions
      .map((expression, index) => `${bareLabel(originals[index])} = ${formatScalar(evaluateExpression(expression, { row }, scope))}`)
      .join(', ')
    buckets.set(key, [...(buckets.get(key) ?? []), row])
  }
  return [...buckets.entries()].map(([key, bucket], index) => ({ id: `group-${index + 1}`, key, rows: bucket }))
}

function bareLabel(expression: Expression) {
  return expression.type === 'column' ? expression.column : expression.label
}

function bareRow(group: Group, select: SelectItem[], scope: Scope): AliasedRow | undefined {
  if (!group.rows.length) return undefined
  const aggregates = select.flatMap((item) => collectAggregates(item.expression))
  const unique = aggregates.filter((aggregate, index) => aggregates.findIndex((other) => other.label === aggregate.label) === index)
  const single = unique.length === 1 ? unique[0] : undefined
  if (!single || (single.fn !== 'MIN' && single.fn !== 'MAX') || !single.column) return group.rows[0]
  let best: AliasedRow | undefined
  let bestValue: Scalar = null
  for (const row of group.rows) {
    const value = evaluateExpression(single.column, { row }, scope)
    if (value === null) continue
    const better = best === undefined || (single.fn === 'MAX' ? compareScalars(value, bestValue) > 0 : compareScalars(value, bestValue) < 0)
    if (better) {
      best = row
      bestValue = value
    }
  }
  return best ?? group.rows[0]
}

/** Header per select item; undefined for the wildcard, whose headers come from the row. */
function resultHeaders(select: SelectItem[], scope: Scope): Array<string | undefined> {
  const preferred = select.map((item) => {
    if (item.expression.type === 'wildcard') return undefined
    if (item.alias) return item.alias
    if (item.expression.type === 'column') return item.expression.column
    return item.expression.label
  })
  return preferred.map((header, index) => {
    const item = select[index]
    if (header === undefined || item.alias || item.expression.type !== 'column') return header
    const collides = preferred.some((other, otherIndex) => otherIndex !== index && other?.toLowerCase() === header.toLowerCase())
    return collides && scope.qualified ? item.expression.label : header
  })
}

function project(select: SelectItem[], headers: Array<string | undefined>, context: Context, index: number, scope: Scope): AliasedRow {
  const entries: [string, Scalar][] = []
  select.forEach((item, itemIndex) => {
    if (item.expression.type === 'wildcard') {
      entries.push(...Object.entries(context.row?.values ?? {}))
      return
    }
    entries.push([headers[itemIndex]!, evaluateExpression(item.expression, context, scope)])
  })
  return { id: `#${index + 1}`, values: Object.fromEntries(entries), columns: entries.map(([key]) => key) }
}

function columnKeys(expression: Expression): string[] {
  if (expression.type === 'column') return [expression.tableAlias ? `${expression.tableAlias}.${expression.column}` : expression.column]
  if (expression.type === 'aggregate') return expression.column ? columnKeys(expression.column) : []
  if (expression.type === 'binary') return [...columnKeys(expression.left), ...columnKeys(expression.right)]
  return []
}

function conditionColumnKeys(condition: Condition, aliasMap: AliasMap) {
  return [...columnKeys(resolveAlias(condition.left, aliasMap)), ...columnKeys(resolveAlias(condition.right, aliasMap))]
}

type SortableRow = {
  row: AliasedRow
  index: number
  keys: Array<{ label: string; value: Scalar; direction: 'ASC' | 'DESC' }>
}

function sortRows(rows: AliasedRow[], contexts: Context[], orderBy: OrderItem[], aliasMap: AliasMap, scope: Scope): SortableRow[] {
  return rows
    .map((row, index): SortableRow => ({
      row,
      index,
      keys: orderBy.map((item) => ({
        label: item.expression.label,
        value: evaluateOrderValue(item.expression, row, contexts[index], aliasMap, scope),
        direction: item.direction,
      })),
    }))
    .sort((left, right) => {
      for (let index = 0; index < orderBy.length; index += 1) {
        const comparison = compareScalars(left.keys[index].value, right.keys[index].value)
        if (comparison !== 0) return left.keys[index].direction === 'DESC' ? -comparison : comparison
      }
      return left.index - right.index
    })
}

function evaluateOrderValue(expression: Expression, projected: AliasedRow, context: Context, aliasMap: AliasMap, scope: Scope): Scalar {
  const columns = projected.columns ?? Object.keys(projected.values)
  if (expression.type === 'literal' && typeof expression.value === 'number' && Number.isInteger(expression.value)) {
    const key = columns[expression.value - 1]
    if (key === undefined) throw new QueryExecutionError(`ORDER BY ${expression.value} is out of range: the result has ${columns.length} column(s).`)
    return projected.values[key]
  }
  if (expression.type === 'column' && !expression.tableAlias) {
    const key = columns.find((column) => column.toLowerCase() === expression.column.toLowerCase())
    if (key !== undefined) return projected.values[key]
  }
  return evaluateExpression(resolveAlias(expression, aliasMap), context, scope)
}

function toSortSummary(item: SortableRow, orderBy: OrderItem[], afterIndex: number): SortSummary {
  return {
    rowId: item.row.id,
    beforeRank: item.index + 1,
    afterRank: afterIndex + 1,
    keys: item.keys.map((key, index) => ({
      label: orderBy[index].expression.label,
      value: key.value,
      direction: key.direction,
    })),
  }
}
```

- [ ] **Step 4: Run the engine and curriculum tests**

Run: `npx vitest run src/domain/engine.test.ts src/domain/c88c.test.ts`
Expected: PASS after the test updates listed in Step 1. If `groups by fur and aggregates per group` in `c88c.test.ts` expected `MAX(height)` per fur group, the values are unchanged; only the `fur` key name may have changed from `fur` (it stays `fur`).

- [ ] **Step 5: Add the Review Focus test for LIMIT larger than the row count**

Already covered by `writes concrete summaries for each step kind` (limit 5 on 3 rows, "Nothing trimmed"). Confirm it also asserts that every row survives, by adding inside that test:

```ts
    // After WHERE the rows are Ada (55), Ada (35), Chen (75) → #1, #2, #3.
    // ORDER BY u.name DESC gives Chen, Ada, Ada, and LIMIT 5 keeps all three.
    expect((steps.at(-1)!.after as AliasedRow[]).map((row) => row.id)).toEqual(['#3', '#1', '#2'])
```

Run: `npx vitest run src/domain/engine.test.ts`
Expected: PASS.

---

### Task 5: Table SQL fixes

**Files:**
- Modify: `src/domain/tableSql.ts`
- Test: `src/domain/tableSql.test.ts`

**Interfaces:**
- Consumes: `splitTopLevel`, `unquoteString`, `isQuotedString`, `maskStrings` from Task 1.
- Produces: unchanged signatures `parseTableSql(input): Table[]`, `serializeTables(tables): string`, `TableDefinitionError`.

- [ ] **Step 1: Add the failing tests**

Append inside the existing `describe` in `src/domain/tableSql.test.ts`:

```ts
  it('unescapes doubled quotes and accepts double-quoted values', () => {
    const [table] = parseTableSql(`CREATE TABLE t (a, b); INSERT INTO t VALUES ('it''s', "dq");`)
    expect(table.rows).toEqual([{ a: "it's", b: 'dq' }])
    expect(serializeTables([table])).toContain("('it''s', 'dq')")
  })

  it('matches table names case-insensitively across statements', () => {
    const [table] = parseTableSql('create table Pets (id); insert into pets values (1);')
    expect(table.name).toBe('Pets')
    expect(table.rows).toEqual([{ id: 1 }])
  })

  it('rejects duplicate tables and duplicate columns', () => {
    expect(() => parseTableSql('CREATE TABLE t (a); CREATE TABLE T (b);')).toThrow('Table "T" is already defined.')
    expect(() => parseTableSql('CREATE TABLE t (a, A);')).toThrow('Table "t" has duplicate column "A".')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/domain/tableSql.test.ts`
Expected: the three new tests FAIL.

- [ ] **Step 3: Update the parser**

In `src/domain/tableSql.ts`:

Replace the imports and the `parseTableSql`, `parseValue` and `splitComma` functions:

```ts
import { isQuotedString, maskStrings, splitOutsideStrings, splitTopLevel, unquoteString } from './sqlText'
import type { Row, Scalar, Table } from './types'
```

```ts
export function parseTableSql(input: string): Table[] {
  const statements = splitOutsideStrings(input, /;/)
    .map((statement) => statement.trim())
    .filter(Boolean)
  const tables = new Map<string, Table>()

  for (const statement of statements) {
    const create = statement.match(/^CREATE\s+TABLE\s+([a-z_][\w]*)\s*\((.+)\)$/is)
    if (create) {
      const name = create[1]
      if (tables.has(name.toLowerCase())) throw new TableDefinitionError(`Table "${name}" is already defined.`)
      const columns = splitTopLevel(create[2]).map((part) => part.trim().split(/\s+/)[0]).filter(Boolean)
      if (!columns.length) throw new TableDefinitionError(`Table "${name}" needs at least one column.`)
      const seen = new Set<string>()
      for (const column of columns) {
        if (seen.has(column.toLowerCase())) throw new TableDefinitionError(`Table "${name}" has duplicate column "${column}".`)
        seen.add(column.toLowerCase())
      }
      tables.set(name.toLowerCase(), { name, columns, rows: [] })
      continue
    }

    const insert = statement.match(/^INSERT\s+INTO\s+([a-z_][\w]*)\s+VALUES\s+(.+)$/is)
    if (insert) {
      const table = tables.get(insert[1].toLowerCase())
      if (!table) throw new TableDefinitionError(`INSERT references unknown table "${insert[1]}". Define it with CREATE TABLE first.`)
      for (const rowText of splitInsertRows(insert[2])) {
        const values = splitTopLevel(rowText).map(parseValue)
        if (values.length !== table.columns.length) {
          throw new TableDefinitionError(`INSERT into "${table.name}" has ${values.length} values but ${table.columns.length} columns.`)
        }
        table.rows.push(Object.fromEntries(table.columns.map((column, index) => [column, values[index]])) as Row)
      }
      continue
    }

    throw new TableDefinitionError(`Unsupported table statement: ${statement}. Use CREATE TABLE and INSERT INTO ... VALUES.`)
  }

  return [...tables.values()]
}

function parseValue(value: string): Scalar {
  const trimmed = value.trim()
  if (isQuotedString(trimmed)) return unquoteString(trimmed)
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (/^null$/i.test(trimmed)) return null
  return trimmed
}
```

Delete the local `splitComma`. In `splitInsertRows`, replace the manual `inQuote` toggling with a scan over `maskStrings(text)` for structure while slicing the original `text` for content:

```ts
function splitInsertRows(text: string) {
  const masked = maskStrings(text)
  const rows: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index]
    if (char === '(') {
      if (depth === 0) start = index + 1
      depth += 1
      continue
    }
    if (char === ')') {
      depth -= 1
      if (depth === 0) rows.push(text.slice(start, index).trim())
      continue
    }
    if (depth === 0 && !/\s|,/.test(char)) {
      throw new TableDefinitionError(`Unsupported INSERT values: ${text.trim()}. Use parenthesized row values.`)
    }
  }
  if (depth !== 0) throw new TableDefinitionError(`Unsupported INSERT values: ${text.trim()}. Check parentheses and quotes.`)
  return rows
}
```

- [ ] **Step 4: Run the table SQL tests**

Run: `npx vitest run src/domain/tableSql.test.ts`
Expected: PASS.

---

### Task 6: Formatter uses the shared helpers

**Files:**
- Modify: `src/domain/sqlFormatter.ts`
- Test: `src/domain/sqlFormatter.test.ts`

**Interfaces:**
- Consumes: `replaceOutsideStrings`, `splitOutsideStrings`, `splitTopLevel`, `maskStrings` from Task 1.
- Produces: unchanged `formatSql(input: string): string`.

- [ ] **Step 1: Add a failing test that pins string safety**

Append to `src/domain/sqlFormatter.test.ts`:

```ts
  it('leaves keywords and separators inside strings alone', () => {
    expect(formatSql("select name from dogs where fur = 'FROM;  here' and x = 1")).toBe(
      "SELECT name\n  FROM dogs\n WHERE fur = 'FROM;  here'\n   AND x = 1",
    )
  })
```

- [ ] **Step 2: Run to verify the current state**

Run: `npx vitest run src/domain/sqlFormatter.test.ts`
Expected: this test may already PASS (the formatter masks strings today). Either way, continue: the point of this task is deleting the duplicated helpers.

- [ ] **Step 3: Replace the local helpers**

In `src/domain/sqlFormatter.ts`:

1. Add `import { maskStrings, replaceOutsideStrings, splitOutsideStrings, splitTopLevel } from './sqlText'`.
2. Replace every `mapUnquoted(text, (part) => part.replace(P, R))` call with `replaceOutsideStrings(text, P, R)`, where `P` must be a global regex:
   - `normalizeWhitespace`: `replaceOutsideStrings(text.trim(), /\s+/g, () => ' ')`
   - `uppercaseKeywords`: `replaceOutsideStrings(text, keywordPattern, (keyword) => keyword.toUpperCase().replace(/\s+/g, ' '))`
   - `breakSelectClauses`: `replaceOutsideStrings(text, clausePattern, (keyword) => `\n${keyword.toUpperCase().replace(/\s+/g, ' ')}`)`
   - `splitAndConditions`: `replaceOutsideStrings(line, /\s+AND\s+/gi, () => '\nAND ')`
3. Replace `splitStatements` with:

```ts
function splitStatements(text: string) {
  const parts = splitOutsideStrings(text, /;/)
  return parts
    .map((part, index) => ({ text: part.trim(), hadTerminator: index < parts.length - 1 }))
    .filter((statement) => statement.text)
}
```

4. Replace the local `splitComma(text)` calls with `splitTopLevel(text)` and delete `splitComma`.
5. Rewrite `splitInsertRows` to scan `maskStrings(text)` exactly as in Task 5 (copy the function, minus the error throws: the formatter just returns what it can).
6. Delete `mapUnquoted`.

- [ ] **Step 4: Run formatter, table SQL and parser tests**

Run: `npx vitest run src/domain`
Expected: PASS for all domain files.

---

### Task 7: Trace table components

**Files:**
- Create: `src/ui/trace/TableView.tsx`, `src/ui/trace/GroupCards.tsx`, `src/ui/trace/SourcesView.tsx`, `src/ui/trace/highlightSets.ts`
- Test: `src/ui/trace/TableView.test.tsx`

**Interfaces:**
- Consumes: `AliasedRow`, `Group`, `Highlight`, `SortSummary` types; `formatScalar` from the engine.
- Produces:
  - `TableView({ rows, highlights?, sortSummaries?, showBadges?, emptyMessage? })`
  - `GroupCards({ groups, highlights?, removedGroupIds?, renderSummary? })`
  - `SourcesView({ sources, highlights, matchList? })`
  - `highlightSets(highlights): { removed: Set<string>; unmatched: Set<string>; matched: Set<string>; selected: Set<string> }` and `isSelectedColumn(column, selected)`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/ui/trace/TableView.test.tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AliasedRow } from '../../domain/types'
import { TableView } from './TableView'

function rows(n: number): AliasedRow[] {
  return Array.from({ length: n }, (_, index) => ({ id: `t${index + 1}`, values: { id: index + 1, name: `row ${index + 1}` } }))
}

describe('TableView', () => {
  it('renders every row when there are 12 or fewer', () => {
    render(<TableView rows={rows(12)} />)
    expect(screen.getAllByRole('row')).toHaveLength(13)
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument()
  })

  it('shows 8 rows and a show-all link for larger tables', async () => {
    render(<TableView rows={rows(20)} />)
    expect(screen.getAllByRole('row')).toHaveLength(9)
    await userEvent.click(screen.getByRole('button', { name: 'Show all 20 rows' }))
    expect(screen.getAllByRole('row')).toHaveLength(21)
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer rows' }))
    expect(screen.getAllByRole('row')).toHaveLength(9)
  })

  it('uses the columns list for order and highlights rows and columns', () => {
    const data: AliasedRow[] = [
      { id: '#1', values: { b: 2, a: 1 }, columns: ['b', 'a'] },
      { id: '#2', values: { b: 4, a: 3 }, columns: ['b', 'a'] },
    ]
    render(
      <TableView
        rows={data}
        highlights={[{ kind: 'removed', rowIds: ['#2'] }, { kind: 'selected', columnKeys: ['u.a'] }]}
      />,
    )
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['row', 'b', 'a'])
    expect(screen.getAllByRole('columnheader')[2]).toHaveClass('selected-column')
    expect(screen.getByText('#2').closest('tr')).toHaveClass('removed-row')
  })

  it('shows rank badges and off-table sort keys from sort summaries', () => {
    const data: AliasedRow[] = [
      { id: '#3', values: { name: 'Chen' }, columns: ['name'] },
      { id: '#1', values: { name: 'Ada' }, columns: ['name'] },
    ]
    render(
      <TableView
        rows={data}
        sortSummaries={[
          { rowId: '#3', beforeRank: 3, afterRank: 1, keys: [{ label: 'height', value: 52, direction: 'DESC' }] },
          { rowId: '#1', beforeRank: 1, afterRank: 2, keys: [{ label: 'height', value: 26, direction: 'DESC' }] },
        ]}
      />,
    )
    const first = screen.getAllByRole('row')[1]
    expect(within(first).getByText('was #3')).toBeInTheDocument()
    expect(within(first).getByText('height 52')).toBeInTheDocument()
  })

  it('renders an empty message', () => {
    render(<TableView rows={[]} emptyMessage="No rows remain." />)
    expect(screen.getByText('No rows remain.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/trace/TableView.test.tsx`
Expected: FAIL – module not found.

- [ ] **Step 3: Implement the helpers and components**

```ts
// src/ui/trace/highlightSets.ts
import type { Highlight } from '../../domain/types'

export function highlightSets(highlights: Highlight[] = []) {
  const collect = (kind: Highlight['kind'], field: 'rowIds' | 'columnKeys' | 'groupIds') =>
    new Set(highlights.filter((highlight) => highlight.kind === kind).flatMap((highlight) => highlight[field] ?? []))
  return {
    removed: collect('removed', 'rowIds'),
    unmatched: collect('unmatched', 'rowIds'),
    matched: collect('matched', 'rowIds'),
    selected: new Set([...collect('selected', 'columnKeys')].map((key) => key.toLowerCase())),
    removedGroups: collect('removed', 'groupIds'),
  }
}

export function isSelectedColumn(column: string, selected: Set<string>) {
  const lower = column.toLowerCase()
  const bare = lower.includes('.') ? lower.slice(lower.indexOf('.') + 1) : lower
  return selected.has(lower) || selected.has(bare) || [...selected].some((key) => key.includes('.') && key.slice(key.indexOf('.') + 1) === bare && !lower.includes('.'))
}
```

```tsx
// src/ui/trace/TableView.tsx
import { useState } from 'react'
import { formatScalar } from '../../domain/engine'
import type { AliasedRow, Highlight, SortSummary } from '../../domain/types'
import { highlightSets, isSelectedColumn } from './highlightSets'

export const FULL_TABLE_ROWS = 12
export const PREVIEW_TABLE_ROWS = 8

export function TableView({
  rows,
  highlights = [],
  sortSummaries,
  showBadges = true,
  emptyMessage = 'No rows.',
}: {
  rows: AliasedRow[]
  highlights?: Highlight[]
  sortSummaries?: SortSummary[]
  showBadges?: boolean
  emptyMessage?: string
}) {
  const [showAll, setShowAll] = useState(false)
  if (!rows.length) return <p className="empty">{emptyMessage}</p>

  const columns = rows[0].columns ?? [...new Set(rows.flatMap((row) => Object.keys(row.values)))]
  const sets = highlightSets(highlights)
  const summaries = new Map((sortSummaries ?? []).map((summary) => [summary.rowId, summary]))
  const expandable = rows.length > FULL_TABLE_ROWS
  const visible = expandable && !showAll ? rows.slice(0, PREVIEW_TABLE_ROWS) : rows

  return (
    <div className="trace-table">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {showBadges ? <th>row</th> : null}
              {columns.map((column) => (
                <th key={column} className={isSelectedColumn(column, sets.selected) ? 'selected-column' : undefined}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const summary = summaries.get(row.id)
              const offTableKeys = summary?.keys.filter((key) => !columns.some((column) => column.toLowerCase() === key.label.toLowerCase())) ?? []
              return (
                <tr key={row.id} className={rowClassName(row.id, sets)}>
                  {showBadges ? (
                    <td>
                      <span className="alias-badge">{row.id}</span>
                      {summary && summary.beforeRank !== summary.afterRank ? <span className="rank-badge">was #{summary.beforeRank}</span> : null}
                      {offTableKeys.map((key) => (
                        <span className="key-badge" key={key.label}>{key.label} {formatScalar(key.value)}</span>
                      ))}
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column} className={isSelectedColumn(column, sets.selected) ? 'selected-column' : undefined}>{formatScalar(row.values[column])}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {expandable ? (
        <button className="show-all-link" type="button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer rows' : `Show all ${rows.length} rows`}
        </button>
      ) : null}
    </div>
  )
}

function rowClassName(rowId: string, sets: ReturnType<typeof highlightSets>) {
  if (sets.removed.has(rowId) || sets.unmatched.has(rowId)) return 'removed-row'
  if (sets.matched.has(rowId)) return 'matched-row'
  return undefined
}
```

```tsx
// src/ui/trace/GroupCards.tsx
import type { ReactNode } from 'react'
import type { Group, Highlight } from '../../domain/types'
import { TableView } from './TableView'

export function GroupCards({
  groups,
  highlights = [],
  removedGroupIds,
  renderSummary,
}: {
  groups: Group[]
  highlights?: Highlight[]
  removedGroupIds?: Set<string>
  renderSummary?: (group: Group) => ReactNode
}) {
  if (!groups.length) return <p className="empty">No groups remain.</p>
  return (
    <div className="group-tables">
      {groups.map((group) => (
        <section className={removedGroupIds?.has(group.id) ? 'group-card removed-card' : 'group-card'} key={group.id} aria-label={`Group ${group.key}`}>
          <header className="group-card-title">
            <span className="band-key">{group.key}</span>
            {renderSummary ? renderSummary(group) : null}
          </header>
          <TableView rows={group.rows} highlights={highlights} />
        </section>
      ))}
    </div>
  )
}
```

```tsx
// src/ui/trace/SourcesView.tsx
import type { ExecutionStep, Highlight } from '../../domain/types'
import { TableView } from './TableView'

export function SourcesView({
  sources,
  highlights,
  matchList,
}: {
  sources: NonNullable<ExecutionStep['sources']>
  highlights: Highlight[]
  matchList?: string[]
}) {
  return (
    <div className="source-grid">
      {sources.map((source) => (
        <section className="source-panel" key={source.label} aria-label={`${source.label} source rows`}>
          <h4>{source.label}</h4>
          <TableView rows={source.rows} highlights={highlights} />
        </section>
      ))}
      {matchList?.length ? (
        <ul className="match-list" aria-label="Join matches">
          {matchList.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run the component tests**

Run: `npx vitest run src/ui/trace/TableView.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the Review Focus test for a large cross join in the trace**

This needs the full app, so add it in Task 10 (test `shows a show-all link for a large cross join`). Note it here so it is not forgotten.

---

### Task 8: Pinned query, timeline and step panel

**Files:**
- Create: `src/ui/trace/PinnedQuery.tsx`, `src/ui/trace/Timeline.tsx`, `src/ui/trace/StepPanel.tsx`
- Test: `src/ui/trace/StepPanel.test.tsx`

**Interfaces:**
- Consumes: Task 7 components; `ExecutionStep`, `Group`, `AliasedRow` types.
- Produces:
  - `PinnedQuery({ sql, clause? })`
  - `Timeline({ steps, stepIndex, onChange })`
  - `StepPanel({ step, isLast })`
  - `findClauseRange(sql, clause): [number, number] | undefined` exported from `PinnedQuery.tsx`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/ui/trace/StepPanel.test.tsx
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { executeQuery } from '../../domain/engine'
import { parseQuery } from '../../domain/parser'
import { initialTables } from '../../domain/samples'
import { StepPanel } from './StepPanel'
import { findClauseRange } from './PinnedQuery'

function stepsFor(sql: string) {
  return executeQuery(parseQuery(sql), initialTables)
}

describe('StepPanel', () => {
  it('shows Before and After side by side for WHERE with faded rows on the left', () => {
    const [, where] = stepsFor("SELECT name FROM users WHERE tier = 'pro'")
    render(<StepPanel step={where} isLast={false} />)
    expect(screen.getByRole('heading', { name: 'WHERE' })).toBeInTheDocument()
    expect(screen.getByText("Kept 2 of 4 rows where tier = 'pro'.")).toBeInTheDocument()
    const before = screen.getByRole('region', { name: 'Before' })
    const after = screen.getByRole('region', { name: 'After' })
    expect(within(before).getByText('Ben').closest('tr')).toHaveClass('removed-row')
    expect(within(after).queryByText('Ben')).not.toBeInTheDocument()
  })

  it('labels the last step After panel as Final result', () => {
    const steps = stepsFor('SELECT name FROM users')
    render(<StepPanel step={steps.at(-1)!} isLast />)
    expect(screen.getByRole('region', { name: 'Final result' })).toBeInTheDocument()
  })

  it('shows sources, key columns and the match list for JOIN', () => {
    const [, join] = stepsFor('SELECT u.name FROM users AS u JOIN listening AS l ON u.id = l.user_id')
    render(<StepPanel step={join} isLast={false} />)
    const before = screen.getByRole('region', { name: 'Before' })
    expect(within(before).getByLabelText('users (as u) source rows')).toBeInTheDocument()
    expect(within(before).getByLabelText('Join matches')).toHaveTextContent('u1 ↔ l1, l2')
    expect(within(before).getAllByRole('columnheader').filter((cell) => cell.classList.contains('selected-column')).map((cell) => cell.textContent)).toEqual(['u.id', 'l.user_id'])
  })

  it('renders group cards with verdicts for HAVING and one group per selectGroup step', () => {
    const steps = stepsFor('SELECT region, COUNT(*) AS n FROM users GROUP BY region HAVING n > 5')
    const having = steps.find((step) => step.kind === 'having')!
    render(<StepPanel step={having} isLast={false} />)
    expect(screen.getAllByText('REJECT')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'After' })).toHaveTextContent('No groups remain.')
  })

  it('finds clause ranges tolerant of whitespace and case', () => {
    expect(findClauseRange('SELECT a\n  FROM t\n WHERE a = 1', 'from t')).toEqual([11, 17])
    expect(findClauseRange('SELECT a FROM t', 'LIMIT 2')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/trace/StepPanel.test.tsx`
Expected: FAIL – modules not found.

- [ ] **Step 3: Implement PinnedQuery**

```tsx
// src/ui/trace/PinnedQuery.tsx
export function PinnedQuery({ sql, clause }: { sql: string; clause?: string }) {
  const range = clause ? findClauseRange(sql, clause) : undefined
  return (
    <pre className="pinned-query" aria-label="Full SQL query">
      <code>
        {range ? (
          <>
            <span>{sql.slice(0, range[0])}</span>
            <span className="active-query-clause">{sql.slice(range[0], range[1])}</span>
            <span>{sql.slice(range[1])}</span>
          </>
        ) : sql}
      </code>
    </pre>
  )
}

// The engine keeps the student's clause text on one line; the formatter wraps and
// indents it. Match tolerant of whitespace and case so the highlight tracks the
// formatted SQL as displayed.
export function findClauseRange(sql: string, clause: string): [number, number] | undefined {
  const pattern = clause
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const match = new RegExp(pattern, 'i').exec(sql)
  if (!match) return undefined
  return [match.index, match.index + match[0].length]
}
```

- [ ] **Step 4: Implement Timeline**

```tsx
// src/ui/trace/Timeline.tsx
import { useEffect, useRef } from 'react'
import type { ExecutionStep } from '../../domain/types'

export function Timeline({
  steps,
  stepIndex,
  onChange,
}: {
  steps: ExecutionStep[]
  stepIndex: number
  onChange: (index: number) => void
}) {
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [stepIndex])

  if (!steps.length) return null
  return (
    <nav className="timeline" aria-label="Execution timeline">
      <div className="timeline-controls">
        <button className="secondary-button" type="button" onClick={() => onChange(stepIndex - 1)} disabled={stepIndex === 0}>
          ← Back
        </button>
        <span className="timeline-position" aria-live="polite">Step {stepIndex + 1} of {steps.length}</span>
        <button className="secondary-button" type="button" onClick={() => onChange(stepIndex + 1)} disabled={stepIndex >= steps.length - 1}>
          Next →
        </button>
      </div>
      <ol className="step-list">
        {steps.map((step, index) => (
          <li key={step.id}>
            <button
              type="button"
              ref={index === stepIndex ? activeRef : undefined}
              className={index === stepIndex ? 'step-pill active' : 'step-pill'}
              aria-current={index === stepIndex ? 'step' : undefined}
              onClick={() => onChange(index)}
            >
              <span>{index + 1}</span>{' '}{step.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
```

- [ ] **Step 5: Implement StepPanel**

```tsx
// src/ui/trace/StepPanel.tsx
import type { ReactNode } from 'react'
import { formatScalar } from '../../domain/engine'
import type { AliasedRow, ExecutionStep, Group } from '../../domain/types'
import { GroupCards } from './GroupCards'
import { highlightSets } from './highlightSets'
import { SourcesView } from './SourcesView'
import { TableView } from './TableView'

export function StepPanel({ step, isLast }: { step: ExecutionStep; isLast: boolean }) {
  const afterLabel = isLast ? 'Final result' : step.kind === 'from' ? 'Loaded rows' : 'After'
  const before = renderBefore(step)
  return (
    <article className="step-panel">
      <p className="eyebrow">Step</p>
      <h2>{step.title}</h2>
      <p className="step-summary">{step.summary}</p>
      <div className={before ? 'step-states two-up' : 'step-states'}>
        {before ? (
          <section className="step-state" aria-label="Before">
            <h3>Before</h3>
            {before}
          </section>
        ) : null}
        <section className="step-state" aria-label={afterLabel}>
          <h3>{afterLabel}</h3>
          {renderAfter(step)}
        </section>
      </div>
    </article>
  )
}

function isGroupList(data?: AliasedRow[] | Group[]): data is Group[] {
  return Boolean(data?.length && 'rows' in data[0])
}

function renderBefore(step: ExecutionStep): ReactNode {
  switch (step.kind) {
    case 'from':
      return null
    case 'join':
      return <SourcesView sources={step.sources ?? []} highlights={step.highlights} matchList={step.details} />
    case 'having':
      return (
        <GroupCards
          groups={step.before as Group[]}
          removedGroupIds={highlightSets(step.highlights).removedGroups}
          renderSummary={(group) => <HavingVerdict group={group} />}
        />
      )
    case 'selectGroup':
      return <GroupCards groups={step.before as Group[]} highlights={step.highlights} />
    default:
      if (isGroupList(step.before)) return <GroupCards groups={step.before} highlights={step.highlights} />
      return <TableView rows={(step.before ?? []) as AliasedRow[]} highlights={step.highlights} emptyMessage="No rows." />
  }
}

function renderAfter(step: ExecutionStep): ReactNode {
  switch (step.kind) {
    case 'from':
      return <SourcesView sources={step.sources ?? []} highlights={step.highlights} />
    case 'groupBy':
      return <GroupCards groups={step.after as Group[]} highlights={step.highlights} />
    case 'having':
      return <GroupCards groups={step.after as Group[]} />
    case 'orderBy':
      return <TableView rows={step.after as AliasedRow[]} highlights={step.highlights} sortSummaries={step.sortSummaries} />
    case 'join':
      return <TableView rows={step.after as AliasedRow[]} highlights={step.highlights.filter((highlight) => highlight.kind === 'selected')} emptyMessage="No rows matched." />
    default:
      return <TableView rows={step.after as AliasedRow[]} highlights={step.highlights.filter((highlight) => highlight.kind === 'matched')} emptyMessage="No rows remain." />
  }
}

// Shows each tested aggregate's computed value and the KEEP / REJECT verdict.
function HavingVerdict({ group }: { group: Group }) {
  const conditions = group.conditions ?? []
  const kept = conditions.every((condition) => condition.result)
  return (
    <span className="band-verdict-line">
      {conditions.map((condition) => (
        <span className="band-actual" key={condition.label}>{condition.leftLabel} = {formatScalar(condition.value)}</span>
      ))}
      <span className={kept ? 'band-verdict band-verdict-keep' : 'band-verdict band-verdict-reject'}>{kept ? 'KEEP' : 'REJECT'}</span>
    </span>
  )
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/ui/trace`
Expected: PASS. If the JOIN test's selected headers come back in a different order, the assertion order is `['u.id', 'l.user_id']` because the users source renders first; keep that.

---

### Task 9: Query editor, tables panel and share modal

**Files:**
- Create: `src/ui/QueryEditor.tsx`, `src/ui/TablesPanel.tsx`, `src/ui/ShareModal.tsx`, `src/ui/highlightSql.tsx`
- Test: `src/ui/highlightSql.test.tsx`

**Interfaces:**
- Consumes: `maskStrings` from Task 1; `TableView` from Task 7; `Table` type.
- Produces:
  - `QueryEditor({ sql, error, onSqlChange, onFormat, onRun, onShare })`
  - `TablesPanel({ tables, tableSql, tableError, open, onToggle, onTableSqlChange, onFormat, onApply })`
  - `ShareModal({ isOpen, shareUrl, copied, onClose, onCopy })`
  - `highlightSql(sql: string): ReactNode[]`

- [ ] **Step 1: Write the failing highlighter test**

```tsx
// src/ui/highlightSql.test.tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { highlightSql } from './highlightSql'

describe('highlightSql', () => {
  it('colours keywords outside strings and marks strings', () => {
    const { container } = render(<pre>{highlightSql("select name from t where a = 'from'")}</pre>)
    const keywords = [...container.querySelectorAll('.sql-keyword')].map((node) => node.textContent)
    expect(keywords).toEqual(['select', 'from', 'where'])
    expect(container.querySelector('.sql-string')?.textContent).toBe("'from'")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/highlightSql.test.tsx`
Expected: FAIL – module not found.

- [ ] **Step 3: Implement the highlighter**

```tsx
// src/ui/highlightSql.tsx
import type { ReactNode } from 'react'
import { maskStrings } from '../domain/sqlText'

const keywordPattern = /\b(GROUP\s+BY|ORDER\s+BY|SELECT|FROM|WHERE|JOIN|HAVING|LIMIT|AS|ON|AND|IS|NOT|NULL|ASC|DESC)\b/gi
const stringPattern = /'[^']*'|"[^"]*"/g

export function highlightSql(sql: string): ReactNode[] {
  const masked = maskStrings(sql)
  const tokens: Array<{ start: number; end: number; className: string }> = []
  for (const match of masked.matchAll(keywordPattern)) {
    tokens.push({ start: match.index, end: match.index + match[0].length, className: keywordClassName(match[1].toUpperCase().replace(/\s+/g, ' ')) })
  }
  for (const match of sql.matchAll(stringPattern)) {
    tokens.push({ start: match.index, end: match.index + match[0].length, className: 'sql-string' })
  }
  tokens.sort((left, right) => left.start - right.start)

  const parts: ReactNode[] = []
  let cursor = 0
  tokens.forEach((token, index) => {
    if (token.start < cursor) return
    if (token.start > cursor) parts.push(<span key={`t${index}`}>{sql.slice(cursor, token.start)}</span>)
    parts.push(<span key={`k${index}`} className={token.className}>{sql.slice(token.start, token.end)}</span>)
    cursor = token.end
  })
  if (cursor < sql.length) parts.push(<span key="tail">{sql.slice(cursor)}</span>)
  return parts
}

function keywordClassName(keyword: string) {
  if (keyword === 'SELECT') return 'sql-keyword sql-keyword-select'
  if (keyword === 'WHERE' || keyword === 'HAVING') return 'sql-keyword sql-keyword-filter'
  if (keyword === 'FROM' || keyword === 'JOIN' || keyword === 'ON') return 'sql-keyword sql-keyword-source'
  if (keyword === 'GROUP BY' || keyword === 'ORDER BY' || keyword === 'LIMIT') return 'sql-keyword sql-keyword-shape'
  return 'sql-keyword sql-keyword-logic'
}
```

- [ ] **Step 4: Implement QueryEditor**

```tsx
// src/ui/QueryEditor.tsx
import { highlightSql } from './highlightSql'

export function QueryEditor({
  sql,
  error,
  onSqlChange,
  onFormat,
  onRun,
  onShare,
}: {
  sql: string
  error?: string
  onSqlChange: (value: string) => void
  onFormat: () => void
  onRun: () => void
  onShare: () => void
}) {
  return (
    <section className="query-card" aria-label="SQL query">
      <label className="field-label" htmlFor="sql-editor">SQL query</label>
      <div className="sql-editor-shell">
        <pre className="sql-highlight" aria-hidden="true">{highlightSql(sql)}</pre>
        <textarea
          id="sql-editor"
          rows={rowsForQuery(sql)}
          value={sql}
          onChange={(event) => onSqlChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onRun()
          }}
          spellCheck={false}
        />
      </div>
      <div className="editor-actions">
        <button className="primary-button" type="button" onClick={onRun}>Run Query</button>
        <button className="secondary-button" type="button" onClick={onFormat} aria-label="Format query SQL">Format</button>
        <button className="secondary-button" type="button" onClick={onShare}>Share</button>
      </div>
      {error ? <div className="error-box" role="alert">{error}</div> : null}
    </section>
  )
}

function rowsForQuery(sql: string) {
  const visualRows = sql.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 72)), 0)
  return Math.min(18, Math.max(4, visualRows + 1))
}
```

- [ ] **Step 5: Implement TablesPanel**

```tsx
// src/ui/TablesPanel.tsx
import type { Table } from '../domain/types'
import { TableView } from './trace/TableView'

export function TablesPanel({
  tables,
  tableSql,
  tableError,
  open,
  onToggle,
  onTableSqlChange,
  onFormat,
  onApply,
}: {
  tables: Table[]
  tableSql: string
  tableError?: string
  open: boolean
  onToggle: (open: boolean) => void
  onTableSqlChange: (value: string) => void
  onFormat: () => void
  onApply: () => void
}) {
  const summary = tables.length
    ? `Tables: ${tables.map((table) => `${table.name} (${table.rows.length})`).join(', ')}`
    : 'Tables: none defined yet'
  return (
    <details className="tables-panel" open={open} onToggle={(event) => onToggle(event.currentTarget.open)}>
      <summary>{summary}</summary>
      <section className="tables-body" aria-label="Table definitions">
        <label className="field-label" htmlFor="table-sql">Table SQL</label>
        <textarea className="table-sql-editor" id="table-sql" value={tableSql} onChange={(event) => onTableSqlChange(event.target.value)} spellCheck={false} />
        <div className="editor-actions">
          <button className="secondary-button" type="button" onClick={onApply}>Apply Tables</button>
          <button className="secondary-button" type="button" onClick={onFormat} aria-label="Format table SQL">Format</button>
        </div>
        {tableError ? <div className="error-box" role="alert">{tableError}</div> : null}
        <div className="table-preview-list" aria-label="Table previews">
          {tables.map((table) => (
            <section className="table-preview" key={table.name} aria-label={`${table.name} preview`}>
              <h3>{table.name} <span className="preview-count">{table.rows.length} rows</span></h3>
              <TableView
                rows={table.rows.map((row, index) => ({ id: String(index + 1), values: row, columns: table.columns }))}
                showBadges={false}
                emptyMessage="No rows inserted."
              />
            </section>
          ))}
        </div>
      </section>
    </details>
  )
}
```

- [ ] **Step 6: Implement ShareModal**

```tsx
// src/ui/ShareModal.tsx
import { useEffect } from 'react'

export function ShareModal({
  isOpen,
  shareUrl,
  copied,
  onClose,
  onCopy,
}: {
  isOpen: boolean
  shareUrl: string
  copied: boolean
  onClose: () => void
  onCopy: () => void
}) {
  useEffect(() => {
    if (!isOpen) return undefined
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
        <button className="modal-close-button" type="button" aria-label="Close share dialog" onClick={onClose}>×</button>
        <h2 id="share-modal-title">Share link</h2>
        <label className="field-label" htmlFor="share-link">Share link</label>
        <input id="share-link" readOnly value={shareUrl} />
        <button className="secondary-button" type="button" onClick={onCopy}>Copy link</button>
        {copied ? <p className="copy-status" role="status">Copied</p> : null}
      </section>
    </div>
  )
}
```

- [ ] **Step 7: Run the highlighter test and type-check the new files**

Run: `npx vitest run src/ui/highlightSql.test.tsx && npx tsc -b --noEmit 2>&1 | grep "src/ui" | head`
Expected: test PASS; no type errors under `src/ui`.

---

### Task 10: Single-page App, CSS, and App tests

**Files:**
- Modify: `src/App.tsx` (full rewrite), `src/App.css`
- Test: `src/App.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: everything from Tasks 7–9; `parseQuery`, `executeQuery`, `formatSql`, `parseTableSql`, `serializeTables`, `createShareUrl`, `readShareSnapshot`, `initialTables`, `starterQuery`.

- [ ] **Step 1: Rewrite the App tests**

Replace `src/App.test.tsx` with:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createShareUrl } from './domain/shareSnapshot'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
})

function renderApp(search = '') {
  window.history.replaceState({}, '', `/${search}`)
  return render(<App />)
}

async function setQuery(sql: string) {
  const editor = screen.getByLabelText('SQL query')
  await userEvent.clear(editor)
  await userEvent.type(editor, sql)
  await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
}

function stepPosition() {
  return screen.getByText(/^Step \d+ of \d+$/).textContent
}

describe('App', () => {
  it('traces the starter query on first load with the query pinned and clause highlighted', () => {
    renderApp()
    expect(screen.queryByRole('button', { name: 'Start visualizing SQL' })).not.toBeInTheDocument()
    expect(stepPosition()).toBe('Step 1 of 4')
    expect(screen.getByRole('heading', { name: 'FROM' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full SQL query')).toHaveTextContent("SELECT u.name, u.tier FROM users AS u WHERE u.tier = 'pro' LIMIT 2")
    expect(screen.getByLabelText('Full SQL query').querySelector('.active-query-clause')).toHaveTextContent('FROM users AS u')
  })

  it('moves through the timeline with buttons, pills and arrow keys', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(stepPosition()).toBe('Step 2 of 4')
    expect(screen.getByRole('heading', { name: 'WHERE' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full SQL query').querySelector('.active-query-clause')).toHaveTextContent("WHERE u.tier = 'pro'")

    await userEvent.keyboard('{ArrowRight}')
    expect(stepPosition()).toBe('Step 3 of 4')
    await userEvent.keyboard('{ArrowLeft}')
    expect(stepPosition()).toBe('Step 2 of 4')

    await userEvent.click(screen.getByRole('button', { name: '4 LIMIT' }))
    expect(stepPosition()).toBe('Step 4 of 4')
    expect(screen.getByRole('region', { name: 'Final result' })).toBeInTheDocument()
    expect(screen.getByText('Nothing trimmed: 2 rows, limit is 2.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next →' })).toBeDisabled()
  })

  it('does not move the timeline when arrow keys are pressed inside an editor', async () => {
    renderApp()
    await userEvent.click(screen.getByLabelText('SQL query'))
    await userEvent.keyboard('{ArrowRight}')
    expect(stepPosition()).toBe('Step 1 of 4')
  })

  it('shows Before and After together for WHERE', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }))
    const before = screen.getByRole('region', { name: 'Before' })
    const after = screen.getByRole('region', { name: 'After' })
    expect(within(before).getByText('Ben').closest('tr')).toHaveClass('removed-row')
    expect(within(after).queryByText('Ben')).not.toBeInTheDocument()
    expect(screen.getByText("Kept 2 of 4 rows where u.tier = 'pro'.")).toBeInTheDocument()
  })

  it('runs a new query, resets to step 1 and shows friendly errors', async () => {
    renderApp()
    await setQuery('SELECT name FROM users ORDER BY name DESC')
    expect(stepPosition()).toBe('Step 1 of 3')
    await userEvent.click(screen.getByRole('button', { name: '3 ORDER BY' }))
    expect(within(screen.getByRole('region', { name: 'Final result' })).getAllByText(/^was #/)).not.toHaveLength(0)

    await setQuery('SELECT name FROM users LIMIT 2 ORDER BY name')
    expect(screen.getByRole('alert')).toHaveTextContent('ORDER BY must come before LIMIT.')
  })

  it('walks grouped queries one group per step and shows HAVING verdicts', async () => {
    renderApp()
    await setQuery('SELECT region, COUNT(*) AS n FROM users GROUP BY region HAVING n > 1')
    expect(stepPosition()).toBe('Step 1 of 5')
    await userEvent.click(screen.getByRole('button', { name: '3 HAVING' }))
    expect(screen.getAllByText('KEEP')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '4 SELECT' }))
    expect(screen.getByText('Collapsed group region = west (2 rows) into one result row (1 of 2).')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'After' })).getAllByRole('row')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '5 SELECT' }))
    expect(within(screen.getByRole('region', { name: 'Final result' })).getAllByRole('row')).toHaveLength(3)
  })

  it('shows a show-all link for a large cross join', async () => {
    renderApp()
    await setQuery('SELECT * FROM users, listening')
    await userEvent.click(screen.getByRole('button', { name: '2 Cross join' }))
    const after = screen.getByRole('region', { name: 'After' })
    expect(within(after).getAllByRole('row')).toHaveLength(9)
    await userEvent.click(within(after).getByRole('button', { name: 'Show all 20 rows' }))
    expect(within(after).getAllByRole('row')).toHaveLength(21)
  })

  it('keeps the Tables section collapsed when tables are valid and opens it on error', async () => {
    renderApp()
    const details = screen.getByText(/^Tables: users \(4\)/).closest('details')!
    expect(details.open).toBe(false)
    await userEvent.click(screen.getByText(/^Tables: users \(4\)/))
    const editor = screen.getByLabelText('Table SQL')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'CREATE TABLE pets (id, name);{enter}INSERT INTO pets VALUES (1);')
    await userEvent.click(screen.getByRole('button', { name: 'Apply Tables' }))
    expect(screen.getByRole('alert')).toHaveTextContent('INSERT into "pets" has 1 values but 2 columns.')
    expect(details.open).toBe(true)
  })

  it('reports an unknown table after tables change and keeps the Tables section open', async () => {
    renderApp()
    await userEvent.click(screen.getByText(/^Tables: users \(4\)/))
    const editor = screen.getByLabelText('Table SQL')
    await userEvent.clear(editor)
    await userEvent.type(editor, "CREATE TABLE pets (id, name);{enter}INSERT INTO pets VALUES (1, 'Miso');")
    await userEvent.click(screen.getByRole('button', { name: 'Apply Tables' }))
    expect(screen.getByText('Tables: pets (1)')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown table "users". Available tables: pets.')
    expect(screen.getByText('Tables: pets (1)').closest('details')!.open).toBe(true)
  })

  it('persists the workspace and restores it on reload', async () => {
    renderApp()
    await setQuery('SELECT name FROM users')
    const saved = JSON.parse(window.localStorage.getItem('c88c-sql-tutor-workspace') ?? '{}')
    expect(saved.sql).toBe('SELECT name\n  FROM users')
  })

  it('opens a share link as a sandbox without touching the saved workspace', async () => {
    window.localStorage.setItem('c88c-sql-tutor-workspace', JSON.stringify({ tables: [], tableSql: 'CREATE TABLE mine (a);', sql: 'SELECT a FROM mine' }))
    const url = new URL(createShareUrl({ origin: window.location.origin, snapshot: { version: 1, tableSql: "CREATE TABLE pets (id, name);\nINSERT INTO pets VALUES (1, 'Miso');", sql: 'SELECT name FROM pets' } }))
    renderApp(url.search)
    expect(screen.getByText('Tables: pets (1)')).toBeInTheDocument()
    expect(screen.getByLabelText('Full SQL query')).toHaveTextContent('SELECT name FROM pets')
    await setQuery('SELECT id FROM pets')
    expect(JSON.parse(window.localStorage.getItem('c88c-sql-tutor-workspace')!).sql).toBe('SELECT a FROM mine')
  })

  it('loads a share link whose query fails and shows the error above an empty trace', () => {
    const url = new URL(createShareUrl({ origin: window.location.origin, snapshot: { version: 1, tableSql: 'CREATE TABLE pets (id);', sql: 'SELECT nope FROM pets' } }))
    renderApp(url.search)
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown column "nope".')
    expect(screen.queryByText(/^Step \d+ of \d+$/)).not.toBeInTheDocument()
    expect(screen.getByText('Run a supported query to see the execution steps.')).toBeInTheDocument()
  })

  it('shows the share link immediately and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(window.navigator, { clipboard: { writeText } })
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog', { name: 'Share link' })
    expect(within(dialog).getByLabelText('Share link')).toHaveValue(expect.stringContaining('share='))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalled()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Copied')
  })
})
```

Note on the second test: the pill's accessible name is the number followed by the title, e.g. "4 LIMIT", because the `<span>` and text are inside one button.

- [ ] **Step 2: Run the App tests to verify they fail**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL across the board (old App still renders the landing page).

- [ ] **Step 3: Rewrite App.tsx**

```tsx
// src/App.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { executeQuery } from './domain/engine'
import { parseQuery } from './domain/parser'
import { initialTables, starterQuery } from './domain/samples'
import { createShareUrl, readShareSnapshot } from './domain/shareSnapshot'
import { formatSql } from './domain/sqlFormatter'
import { parseTableSql, serializeTables } from './domain/tableSql'
import type { ExecutionStep, Table } from './domain/types'
import { QueryEditor } from './ui/QueryEditor'
import { ShareModal } from './ui/ShareModal'
import { TablesPanel } from './ui/TablesPanel'
import { PinnedQuery } from './ui/trace/PinnedQuery'
import { StepPanel } from './ui/trace/StepPanel'
import { Timeline } from './ui/trace/Timeline'

const workspaceStorageKey = 'c88c-sql-tutor-workspace'

type Workspace = { tables: Table[]; tableSql: string; sql: string }

type InitialState = Workspace & { tableError?: string; isSharedSession: boolean }

function App() {
  const initial = useMemo(() => initializeState(), [])
  // Format before the first run so the pinned query and the saved workspace match what Run would produce.
  const initialSql = useMemo(() => formatSql(initial.sql), [initial.sql])
  const initialRun = useMemo(() => run(initialSql, initial.tables), [initialSql, initial.tables])
  const [tables, setTables] = useState(initial.tables)
  const [tableSql, setTableSql] = useState(initial.tableSql)
  const [tableError, setTableError] = useState(initial.tableError)
  const [sql, setSql] = useState(initialSql)
  const [error, setError] = useState(initialRun.error)
  const [steps, setSteps] = useState<ExecutionStep[]>(initialRun.steps)
  const [stepIndex, setStepIndex] = useState(0)
  const [tablesOpen, setTablesOpen] = useState(Boolean(initial.tableError) || initial.tables.length === 0)
  const [shareModal, setShareModal] = useState({ isOpen: false, shareUrl: '', copied: false })
  const [isSharedSession] = useState(initial.isSharedSession)
  const traceRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (isSharedSession) return
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify({ tables, tableSql, sql }))
  }, [tables, tableSql, sql, isSharedSession])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'ArrowRight') setStepIndex((value) => Math.min(steps.length - 1, value + 1))
      if (event.key === 'ArrowLeft') setStepIndex((value) => Math.max(0, value - 1))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [steps.length])

  function handleRun(nextSql = sql, nextTables = tables) {
    const formatted = formatSql(nextSql)
    const result = run(formatted, nextTables)
    setSql(formatted)
    setError(result.error)
    if (!result.error) {
      setSteps(result.steps)
      setStepIndex(0)
      traceRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }
  }

  function handleApplyTables() {
    const formatted = formatSql(tableSql)
    setTableSql(formatted)
    try {
      const nextTables = parseTableSql(formatted)
      setTables(nextTables)
      setTableError(undefined)
      const result = run(sql, nextTables)
      setError(result.error)
      if (result.error) {
        setTablesOpen(true)
      } else {
        setSteps(result.steps)
        setStepIndex(0)
        setTablesOpen(false)
      }
    } catch (caught) {
      setTableError(caught instanceof Error ? caught.message : 'The table SQL could not be applied.')
      setTablesOpen(true)
    }
  }

  function handleShare() {
    const shareUrl = createShareUrl({ origin: window.location.origin, snapshot: { version: 1, tableSql, sql } })
    void window.navigator.clipboard?.writeText(shareUrl)
    setShareModal({ isOpen: true, shareUrl, copied: false })
  }

  function handleCopy() {
    void window.navigator.clipboard?.writeText(shareModal.shareUrl)
    setShareModal((current) => ({ ...current, copied: true }))
  }

  const activeStep = steps[stepIndex]

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">SQL</span>
          <span className="brand-copy">
            <span className="brand-title">CSM C88C SQL Visualizer</span>
            <span className="brand-subtitle">See how SQL builds a result, one clause at a time.</span>
          </span>
        </div>
      </header>

      <QueryEditor sql={sql} error={error} onSqlChange={setSql} onFormat={() => setSql(formatSql(sql))} onRun={() => handleRun()} onShare={handleShare} />

      <TablesPanel
        tables={tables}
        tableSql={tableSql}
        tableError={tableError}
        open={tablesOpen}
        onToggle={setTablesOpen}
        onTableSqlChange={setTableSql}
        onFormat={() => setTableSql(formatSql(tableSql))}
        onApply={handleApplyTables}
      />

      <section className="trace" ref={traceRef} aria-labelledby="trace-heading">
        <h1 id="trace-heading" className="visually-hidden">Trace</h1>
        {steps.length ? (
          <>
            <PinnedQuery sql={sql} clause={activeStep?.clause} />
            <Timeline steps={steps} stepIndex={stepIndex} onChange={(index) => setStepIndex(Math.max(0, Math.min(steps.length - 1, index)))} />
            {activeStep ? <StepPanel key={activeStep.id} step={activeStep} isLast={stepIndex === steps.length - 1} /> : null}
          </>
        ) : (
          <p className="empty">Run a supported query to see the execution steps.</p>
        )}
      </section>

      <ShareModal
        isOpen={shareModal.isOpen}
        shareUrl={shareModal.shareUrl}
        copied={shareModal.copied}
        onClose={() => setShareModal((current) => ({ ...current, isOpen: false, copied: false }))}
        onCopy={handleCopy}
      />
    </main>
  )
}

function initializeState(): InitialState {
  try {
    const shared = readShareSnapshot(window.location.search)
    if (shared) {
      return { tables: parseTableSql(shared.tableSql), tableSql: shared.tableSql, sql: shared.sql, isSharedSession: true }
    }
  } catch (caught) {
    return { ...loadWorkspace(), tableError: caught instanceof Error ? caught.message : 'The shared link is invalid.', isSharedSession: false }
  }
  const workspace = loadWorkspace()
  try {
    return { ...workspace, tables: parseTableSql(workspace.tableSql), isSharedSession: false }
  } catch (caught) {
    return { ...workspace, tableError: caught instanceof Error ? caught.message : 'The table SQL could not be applied.', isSharedSession: false }
  }
}

function loadWorkspace(): Workspace {
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey)
    if (!raw) throw new Error('No saved workspace')
    const parsed = JSON.parse(raw) as Partial<Workspace>
    if (!Array.isArray(parsed.tables) || typeof parsed.tableSql !== 'string' || typeof parsed.sql !== 'string') throw new Error('Invalid saved workspace')
    return { tables: parsed.tables, tableSql: parsed.tableSql, sql: parsed.sql }
  } catch {
    return { tables: initialTables, tableSql: serializeTables(initialTables), sql: starterQuery }
  }
}

function run(sql: string, tables: Table[]) {
  try {
    return { steps: executeQuery(parseQuery(sql), tables), error: undefined as string | undefined }
  } catch (caught) {
    return { steps: [] as ExecutionStep[], error: caught instanceof Error ? caught.message : 'The query could not be visualized.' }
  }
}

export default App
```

One detail the tests depend on: the starter query is formatted before its first run (see `initialSql` above), so the pinned query shows `SELECT u.name, u.tier\n  FROM users AS u ...`; `toHaveTextContent` normalises whitespace so the assertion still matches.

- [ ] **Step 4: Update the CSS**

In `src/App.css`:

1. Delete rule blocks for these selectors (they have no consumers now): `.landing-shell`, `.landing-page`, `.landing-copy`, `.landing-cta`, `.route-tabs` (and children), `.workflow-page`, `.pane-heading`, `.compact-heading`, `.back-button`, `.query-page-grid`, `.query-route`, `.tables-route`, `.table-context`, `.compact-preview-list`, `.pagination-controls`, `.trace-pagination-controls`, `.preview-header`, `.trace-state-toggle`, `.centered-toggle`, `.query-context-toggle`, `.active-clause`, `.select-collapse*`, `.step-rail`, `.step-controls`, `.centered-step-controls`, `.icon-button`, `.reset-button`, `.share-loading`, `.share-spinner`, `.visualization-route`, `.visualization-panel`, `.trace-title-section`, `.trace-order-note`, `.trace-pane`, `.trace-card`, `.trace-stepper-card`, `.table-builder`, `.table-mode-panel`, `.authoring-*`, `.build-pane`, `.section-heading-row`, `.pane-copy`, `.detail-list`, `.explanation`, `.trace-comment`, `.trace-table-section`, `.full-query-panel`, `.band-verdict-line` (keep `.band-*` otherwise). Grep each name after deleting to confirm zero references in `src/`.
2. Make `.brand-lockup` a `div` style (remove button resets if any).
3. Append:

```css
/* Single-page layout */
.app-shell {
  display: grid;
  gap: 20px;
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 16px 48px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Tables disclosure */
.tables-panel {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
}

.tables-panel > summary {
  cursor: pointer;
  padding: 14px 18px;
  font-weight: 600;
  color: var(--ink);
  list-style: none;
}

.tables-panel > summary::-webkit-details-marker { display: none; }

.tables-panel > summary::before {
  content: '▸';
  display: inline-block;
  width: 1.2em;
  color: var(--muted);
  transition: transform 120ms ease;
}

.tables-panel[open] > summary::before { transform: rotate(90deg); }

.tables-body {
  display: grid;
  gap: 14px;
  padding: 0 18px 18px;
}

.table-preview h3 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 8px;
}

.preview-count { font-size: 0.8rem; color: var(--muted); font-weight: 500; }

/* Trace */
.trace {
  display: grid;
  gap: 16px;
  scroll-margin-top: 16px;
}

.pinned-query {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--code);
  color: #e6edf3;
  font-size: 0.95rem;
  line-height: 1.5;
  overflow-x: auto;
}

.timeline {
  display: grid;
  gap: 12px;
  padding: 14px 18px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
}

.timeline-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.timeline-position { font-weight: 600; color: var(--ink); min-width: 8ch; text-align: center; }

.step-list {
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  overflow-x: auto;
}

.step-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--muted);
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.step-pill span {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--paper);
  font-size: 0.8rem;
}

.step-pill.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.step-pill.active span { background: rgba(255, 255, 255, 0.25); color: #fff; }

.step-panel {
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
}

.step-panel h2 { margin: 0; }
.step-summary { margin: 0; font-size: 1.05rem; color: var(--ink); }

.step-states { display: grid; gap: 16px; }

@media (min-width: 960px) {
  .step-states.two-up { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
}

.step-state { display: grid; gap: 8px; min-width: 0; }
.step-state h3 { margin: 0; font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }

.show-all-link {
  justify-self: start;
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-dark);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}

.rank-badge,
.key-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--secondary-soft);
  color: var(--secondary);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.match-list {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
  color: var(--ink);
}

.sql-string { color: #f4d35e; }

.band-verdict-line { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
```

- [ ] **Step 5: Run the App tests**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS. Common failures and fixes:
- `Step 1 of 4` mismatch: the starter query yields FROM, WHERE, SELECT, LIMIT = 4 steps; confirm no Result step is emitted.
- Pill name mismatch: Testing Library computes "4 LIMIT" from the number span plus text; if it reads "4LIMIT", add a space: `<span>{index + 1}</span>{' '}{step.title}`.
- `details.open` stays true because jsdom does not fire `toggle` for the initial `open` prop: that is fine, the assertions check the prop-driven state after `Apply Tables`.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all files PASS.

---

### Task 11: Docs, lint, build, final verification and single commit

**Files:**
- Modify: `HANDOFF.md`, `README.md`
- Delete: `src/ui/trace/../../assets/react.svg` and `vite.svg` only if unreferenced (check with grep; leave otherwise).

- [ ] **Step 1: Update HANDOFF.md**

Rewrite these sections:
- **Architecture Overview**: the app is a single page (`src/App.tsx` holds state and wiring; components live in `src/ui/` and `src/ui/trace/`); no router; share links still load from `?share=`.
- **Supported SQL Subset**: add `IS NULL` / `IS NOT NULL`, parentheses in arithmetic, `ORDER BY` by position, SELECT aliases in GROUP BY / HAVING / ORDER BY, case-insensitive identifiers, NULL comparison semantics, SQLite bare-column MIN/MAX rule; note clause order is enforced and OFFSET is rejected by name.
- **Data Model Reference**: `AliasedRow` has `id`, `values`, optional `columns`; `Group` has `id`, `key`, `rows`, optional `conditions`; `ExecutionStep` has `summary`, optional `clause`, `before`, `after`, `sources`, `details` (JOIN only), `highlights` (`removed`, `selected`, `matched`, `unmatched`), `sortSummaries`; `QueryAST.clauses` holds raw clause text.
- **Logical Execution Order**: FROM, JOIN, one WHERE per AND-ed condition, GROUP BY (implicit when aggregates are present), HAVING, SELECT (one `selectGroup` step per group when grouped), ORDER BY, LIMIT. No Result step; the last step's After panel is the final result.
- **Visual Conventions**: green accent (not teal); pinned query with highlighted clause; Before/After side by side; faded rows for removed and unmatched; green selected columns; purple group cards and rank badges; tables show 12 rows or fewer in full, otherwise 8 plus "Show all".
- **Test Strategy**: list `sqlText.test.ts`, `TableView.test.tsx`, `StepPanel.test.tsx`, `highlightSql.test.tsx`, and describe the rewritten App tests.
- **Shared helpers**: `src/domain/sqlText.ts` is the only place that knows how to skip over string literals; parser, formatter, table SQL and the editor highlighter use it.

- [ ] **Step 2: Update README.md**

- Remove the "Starter Query" section's claim about routes, if any; describe the single page: query editor, collapsible Tables section, trace with pinned query and timeline.
- Extend "Supported SQL" with the same additions as HANDOFF.
- Keep Local Setup, Verification and Deployment as they are.

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed. Typical lint fixes: unused imports left over in `App.tsx`, `react-hooks/exhaustive-deps` on the keydown effect (the dependency is `steps.length`, already listed).

- [ ] **Step 4: Full test run**

Run: `npm test`
Expected: all PASS. Paste the summary line into the final report.

- [ ] **Step 5: Manual smoke check in the browser**

Run: `npx vite --port 5199 --strictPort` and open `http://localhost:5199/`. Check: starter trace visible on load; Next/Back and arrow keys work; pinned query highlights each clause; JOIN step shows sources, key columns and the match list; a `GROUP BY ... HAVING` query shows KEEP/REJECT and one SELECT step per group; `SELECT * FROM users, listening` shows the "Show all 20 rows" link; Tables section expands on a bad INSERT; Share opens instantly. Stop the server afterwards.

- [ ] **Step 6: Commit everything once**

```bash
git add -A
git commit -m "Flatten the trace into one timeline on a single page and match SQLite semantics

- Single page: pinned query with active clause, Step N of M timeline, Before/After per step
- One selectGroup step per group; concrete step summaries; join match lists and sort badges
- Engine: NULL semantics, IS NULL, COUNT(column), zero-row aggregates, MIN/MAX bare columns,
  ORDER BY position, aliases in GROUP BY/HAVING/ORDER BY, case-insensitive names, parentheses
- Parser: string-aware tokenizing via sqlText.ts, clause-order errors, clearer unsupported messages
- Table SQL: quote unescaping, double quotes, duplicate table/column errors
- Removed router, landing page, pagination, fake share spinner and unused step metadata"
```
