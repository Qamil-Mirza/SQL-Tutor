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
  validateColumns(ast, aliasMap, scope, [
    { alias: ast.from.alias, table: fromTable },
    ...(ast.join && joinTable ? [{ alias: ast.join.alias, table: joinTable }] : []),
  ])

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
    for (const [index, expression] of groupExpressions.entries()) {
      const aggregate = collectAggregates(expression)[0]
      if (aggregate) {
        const written = ast.groupBy[index].label
        throw new QueryExecutionError(
          written === aggregate.label
            ? `${aggregate.label} can't be used in GROUP BY. Group by a column instead.`
            : `${written} can't be used in GROUP BY because it is ${aggregate.label}. Group by a column instead.`,
        )
      }
    }
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
  const l = String(left)
  const r = String(right)
  return l < r ? -1 : l > r ? 1 : 0
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
  // Like SQLite: dividing by zero yields NULL, and integer / integer truncates toward zero.
  if (rightNumber === 0) return null
  if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber) && !isRealTyped(expression)) return Math.trunc(leftNumber / rightNumber)
  return leftNumber / rightNumber
}

/** True when SQLite would treat the expression as REAL regardless of its value: AVG, a literal like 2.0, or arithmetic over either. */
function isRealTyped(expression: Expression): boolean {
  if (expression.type === 'aggregate') return expression.fn === 'AVG'
  if (expression.type === 'literal') return typeof expression.value === 'number' && expression.label.includes('.')
  if (expression.type === 'binary') return isRealTyped(expression.left) || isRealTyped(expression.right)
  return false
}

type Source = { alias: string; table: Table }

/** Checks every column reference against the source tables before any row is read, so typos fail even when no rows reach a clause. */
function validateColumns(ast: QueryAST, aliasMap: AliasMap, scope: Scope, sources: Source[]) {
  const hasColumn = (table: Table, column: string) => table.columns.some((candidate) => candidate.toLowerCase() === column.toLowerCase())
  const outputNames = new Set(
    resultHeaders(ast.select, scope)
      .filter((header): header is string => header !== undefined)
      .map((header) => header.toLowerCase()),
  )
  const check = (expression: Expression | undefined, isOrderBy = false) => {
    if (!expression) return
    if (expression.type === 'aggregate') return check(expression.column)
    if (expression.type === 'binary') {
      check(expression.left, isOrderBy)
      check(expression.right, isOrderBy)
      return
    }
    if (expression.type !== 'column') return
    if (expression.tableAlias) {
      const source = sources.find((candidate) => candidate.alias.toLowerCase() === expression.tableAlias!.toLowerCase())
      if (!source) throw new QueryExecutionError(`Unknown table alias "${expression.tableAlias}". Available: ${scope.aliases.join(', ')}.`)
      if (!hasColumn(source.table, expression.column)) throw new QueryExecutionError(`Unknown column "${expression.tableAlias}.${expression.column}".`)
      return
    }
    if (isOrderBy && outputNames.has(expression.column.toLowerCase())) return
    if (!sources.some((source) => hasColumn(source.table, expression.column))) throw new QueryExecutionError(`Unknown column "${expression.column}".`)
  }
  // SELECT, JOIN and WHERE are evaluated without alias resolution, so they are checked as written.
  ast.select.forEach((item) => check(item.expression))
  ast.join?.conditions.forEach((condition) => [condition.left, condition.right].forEach((side) => check(side)))
  ast.where.forEach((condition) => [condition.left, condition.right].forEach((side) => check(side)))
  ast.groupBy.forEach((expression) => check(resolveAlias(expression, aliasMap)))
  ast.having.forEach((condition) => [condition.left, condition.right].forEach((side) => check(resolveAlias(side, aliasMap))))
  ast.orderBy.forEach((item) => check(resolveAlias(item.expression, aliasMap), true))
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
      .map((expression, index) => {
        const value = evaluateExpression(expression, { row }, scope)
        return `${bareLabel(originals[index])} = ${value === null ? 'NULL' : formatScalar(value)}`
      })
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
      label: sortKeyLabel(orderBy[index].expression, item.row),
      value: key.value,
      direction: key.direction,
    })),
  }
}

/** ORDER BY 2 is labelled with the result column it names, e.g. "salary". */
function sortKeyLabel(expression: Expression, row: AliasedRow) {
  if (expression.type === 'literal' && typeof expression.value === 'number' && Number.isInteger(expression.value)) {
    return row.columns?.[expression.value - 1] ?? expression.label
  }
  return expression.label
}
