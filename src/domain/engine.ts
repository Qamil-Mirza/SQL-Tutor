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
  Table,
} from './types'

export class QueryExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryExecutionError'
  }
}

export function executeQuery(ast: QueryAST, tables: Table[]): ExecutionStep[] {
  const steps: ExecutionStep[] = []
  const fromTable = requireTable(tables, ast.from.tableName)
  const commaJoinTable = ast.join?.syntax === 'comma' ? requireTable(tables, ast.join.tableName) : undefined
  let rows = aliasRows(fromTable, ast.from.alias)
  steps.push({
    id: 'from',
    kind: 'from',
    title: 'FROM',
    explanation: commaJoinTable
      ? `Start with every row from ${fromTable.name} as ${ast.from.alias} and ${commaJoinTable.name} as ${ast.join!.alias}.`
      : `Start with every row from ${fromTable.name}, labeled as alias ${ast.from.alias}.`,
    after: rows,
    details: commaJoinTable
      ? [`${rows.length} row(s) from ${ast.from.alias}.`, `${commaJoinTable.rows.length} row(s) from ${ast.join!.alias}.`]
      : [`${rows.length} source rows are now available.`],
    highlights: [{ kind: 'kept', rowIds: rows.map((row) => row.id) }],
  })

  if (ast.join) {
    const rightTable = requireTable(tables, ast.join.tableName)
    const before = rows
    const rightRows = aliasRows(rightTable, ast.join.alias)
    const joined: AliasedRow[] = []
    const details: string[] = []
    for (const left of rows) {
      for (const right of rightRows) {
        const candidate = mergeRows(left, right)
        if (!ast.join.condition || evaluateCondition(ast.join.condition, candidate)) {
          joined.push(candidate)
          details.push(ast.join.condition ? `${left.id} matched ${right.id} on ${ast.join.condition.label}` : `${left.id} paired with ${right.id}`)
        }
      }
    }
    rows = joined
    steps.push({
      id: 'join',
      kind: 'join',
      title: 'JOIN',
      explanation: ast.join.condition
        ? `Pair rows from ${ast.from.alias} and ${ast.join.alias} when the ON condition is true.`
        : `Pair every row from ${ast.from.alias} with every row from ${ast.join.alias}.`,
      before,
      after: rows,
      details,
      highlights: [{ kind: 'matched', rowIds: rows.map((row) => row.id) }],
    })
  }

  if (ast.where.length) {
    ast.where.forEach((condition, index) => {
      const before = rows
      rows = rows.filter((row) => evaluateCondition(condition, row))
      steps.push({
        id: ast.where.length === 1 ? 'where' : `where-${index + 1}`,
        kind: 'where',
        title: 'WHERE',
        explanation: 'Filter individual rows before grouping happens.',
        before,
        after: markRemoved(before, rows),
        details: [condition.label],
        highlights: [
          { kind: 'kept', rowIds: rows.map((row) => row.id) },
          { kind: 'removed', rowIds: before.filter((row) => !rows.includes(row)).map((row) => row.id) },
        ],
      })
    })
  }

  let groups: Group[] | undefined
  if (ast.groupBy.length || hasAggregates(ast.select) || ast.having.length) {
    groups = groupRows(rows, ast.groupBy)
    steps.push({
      id: 'group',
      kind: 'groupBy',
      title: 'GROUP BY',
      explanation: ast.groupBy.length
        ? 'Bucket rows by the GROUP BY expressions before aggregate calculations.'
        : 'Treat all remaining rows as one group because aggregate functions are present.',
      before: rows,
      after: groups,
      details: groups.map((group) => `${group.key}: ${group.rows.length} row(s)`),
      highlights: [{ kind: 'grouped', groupIds: groups.map((group) => group.id) }],
    })
  }

  if (groups && ast.having.length) {
    const before = groups
    groups = groups.filter((group) => ast.having.every((condition) => evaluateCondition(condition, group.rows[0], group)))
    steps.push({
      id: 'having',
      kind: 'having',
      title: 'HAVING',
      explanation: 'Filter groups after aggregates are available.',
      before,
      after: groups,
      details: ast.having.map((condition) => condition.label),
      highlights: [
        { kind: 'kept', groupIds: groups.map((group) => group.id) },
        { kind: 'removed', groupIds: before.filter((group) => !groups?.includes(group)).map((group) => group.id) },
      ],
    })
  }

  const beforeSelect = groups ?? rows
  const projectionContexts = groups
    ? groups.map((group) => ({ row: group.rows[0], group }))
    : rows.map((row) => ({ row }))
  rows = projectRows(ast.select, rows, groups)
  steps.push({
    id: 'select',
    kind: 'select',
    title: 'SELECT',
    explanation: 'Project the requested expressions into the visible result columns.',
    before: beforeSelect,
    after: rows,
    details: ast.select.map((item) => item.label),
    highlights: [{ kind: 'selected', columnKeys: Object.keys(rows[0]?.values ?? {}) }],
  })

  if (ast.orderBy.length) {
    const before = rows
    const sorted = sortRows(rows, projectionContexts, ast.orderBy)
    rows = sorted.map((item) => item.row)
    steps.push({
      id: 'order-by',
      kind: 'orderBy',
      title: 'ORDER BY',
      explanation: 'Sort the projected result rows before LIMIT is applied.',
      before,
      after: rows,
      details: ast.orderBy.map((item) => item.label),
      highlights: [{ kind: 'kept', rowIds: rows.map((row) => row.id) }],
    })
  }

  if (ast.limit !== undefined) {
    const before = rows
    rows = rows.slice(0, ast.limit)
    steps.push({
      id: 'limit',
      kind: 'limit',
      title: 'LIMIT',
      explanation: `Keep only the first ${ast.limit} row(s) after projection.`,
      before,
      after: markRemoved(before, rows),
      details: [`${Math.max(0, before.length - rows.length)} row(s) trimmed.`],
      highlights: [
        { kind: 'kept', rowIds: rows.map((row) => row.id) },
        { kind: 'removed', rowIds: before.filter((row) => !rows.includes(row)).map((row) => row.id) },
      ],
    })
  }

  steps.push({
    id: 'result',
    kind: 'result',
    title: 'Result',
    explanation: 'This is the final result produced by the logical execution order.',
    after: rows,
    highlights: [{ kind: 'kept', rowIds: rows.map((row) => row.id) }],
  })
  return steps
}

function requireTable(tables: Table[], name: string) {
  const table = tables.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())
  if (!table) throw new QueryExecutionError(`Unknown table "${name}". Available tables: ${tables.map((item) => item.name).join(', ')}.`)
  return table
}

function aliasRows(table: Table, alias: string): AliasedRow[] {
  return table.rows.map((row, index) => ({
    id: `${alias}:${table.name}-${index + 1}`,
    provenance: [`${table.name}-${index + 1}`],
    values: Object.fromEntries(table.columns.map((column) => [`${alias}.${column}`, row[column]])),
  }))
}

function mergeRows(left: AliasedRow, right: AliasedRow): AliasedRow {
  return {
    id: `${left.id}+${right.id}`,
    provenance: [...left.provenance, ...right.provenance],
    values: { ...left.values, ...right.values },
  }
}

function evaluateCondition(condition: Condition, row: AliasedRow, group?: Group) {
  const left = evaluateExpression(condition.left, row, group)
  const right = evaluateExpression(condition.right, row, group)
  switch (condition.operator) {
    case '=':
      return left === right
    case '!=':
    case '<>':
      return left !== right
    case '>':
      return compareScalars(left, right) > 0
    case '<':
      return compareScalars(left, right) < 0
    case '>=':
      return compareScalars(left, right) >= 0
    case '<=':
      return compareScalars(left, right) <= 0
  }
}

function compareScalars(left: Scalar, right: Scalar) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) return leftNumber - rightNumber
  return String(left).localeCompare(String(right))
}

function evaluateExpression(expression: Expression, row: AliasedRow, group?: Group): Scalar {
  if (expression.type === 'literal') return expression.value
  if (expression.type === 'column') return readColumn(row, expression)
  if (expression.type === 'wildcard') throw new QueryExecutionError('SELECT * can only be used as a projection.')
  if (expression.type === 'binary') return evaluateBinaryExpression(expression, row, group)
  const rows = group?.rows ?? [row]
  if (expression.fn === 'COUNT') return rows.length
  const values = rows.map((item) => Number(evaluateExpression(expression.column!, item))).filter((value) => !Number.isNaN(value))
  if (expression.fn === 'SUM') return values.reduce((total, value) => total + value, 0)
  if (expression.fn === 'AVG') return values.reduce((total, value) => total + value, 0) / values.length
  if (expression.fn === 'MIN') return Math.min(...values)
  return Math.max(...values)
}

function evaluateBinaryExpression(expression: Extract<Expression, { type: 'binary' }>, row: AliasedRow, group?: Group) {
  const left = Number(evaluateExpression(expression.left, row, group))
  const right = Number(evaluateExpression(expression.right, row, group))
  if (Number.isNaN(left) || Number.isNaN(right)) throw new QueryExecutionError(`Arithmetic expression "${expression.label}" must use numeric values.`)
  if (expression.operator === '+') return left + right
  if (expression.operator === '-') return left - right
  if (expression.operator === '*') return left * right
  if (right === 0) throw new QueryExecutionError(`Arithmetic expression "${expression.label}" divides by zero.`)
  return left / right
}

function readColumn(row: AliasedRow, expression: Extract<Expression, { type: 'column' }>) {
  if (expression.tableAlias) {
    const key = `${expression.tableAlias}.${expression.column}`
    if (!(key in row.values)) throw new QueryExecutionError(`Unknown column "${key}".`)
    return row.values[key]
  }
  const matches = Object.keys(row.values).filter((key) => key.endsWith(`.${expression.column}`))
  if (matches.length === 0) throw new QueryExecutionError(`Unknown column "${expression.column}".`)
  if (matches.length > 1) throw new QueryExecutionError(`Column "${expression.column}" is ambiguous. Qualify it with a table alias.`)
  return row.values[matches[0]]
}

function groupRows(rows: AliasedRow[], expressions: Expression[]): Group[] {
  const buckets = new Map<string, AliasedRow[]>()
  for (const row of rows) {
    const values = expressions.length ? expressions.map((expression) => String(evaluateExpression(expression, row))) : ['all rows']
    const key = values.join(' | ')
    buckets.set(key, [...(buckets.get(key) ?? []), row])
  }
  return [...buckets.entries()].map(([key, bucket], index) => ({
    id: `group-${index + 1}`,
    key,
    rows: bucket,
    values: { Group: key, Rows: bucket.length },
  }))
}

function projectRows(select: SelectItem[], rows: AliasedRow[], groups?: Group[]): AliasedRow[] {
  if (groups) {
    return groups.map((group, index) => projectOne(select, group.rows[0], `result-${index + 1}`, group))
  }
  return rows.map((row, index) => projectOne(select, row, `result-${index + 1}`))
}

function projectOne(select: SelectItem[], row: AliasedRow, id: string, group?: Group): AliasedRow {
  return {
    id,
    provenance: row.provenance,
    values: Object.fromEntries(select.flatMap((item) => projectSelectItem(item, row, group))),
  }
}

function hasAggregates(select: SelectItem[]) {
  return select.some((item) => hasAggregateExpression(item.expression))
}

function hasAggregateExpression(expression: Expression): boolean {
  if (expression.type === 'aggregate') return true
  if (expression.type === 'binary') return hasAggregateExpression(expression.left) || hasAggregateExpression(expression.right)
  return false
}

function projectSelectItem(item: SelectItem, row: AliasedRow, group?: Group): [string, Scalar][] {
  if (item.expression.type === 'wildcard') return wildcardEntries(row)
  return [[item.alias ?? item.expression.label, evaluateExpression(item.expression, row, group)]]
}

function sortRows(rows: AliasedRow[], contexts: Array<{ row: AliasedRow; group?: Group }>, orderBy: OrderItem[]) {
  return rows
    .map((row, index) => ({ row, context: contexts[index], index }))
    .sort((left, right) => {
      for (const order of orderBy) {
        const leftValue = evaluateOrderExpression(order.expression, left.row, left.context)
        const rightValue = evaluateOrderExpression(order.expression, right.row, right.context)
        const comparison = compareScalars(leftValue, rightValue)
        if (comparison !== 0) return order.direction === 'DESC' ? -comparison : comparison
      }
      return left.index - right.index
    })
}

function evaluateOrderExpression(expression: Expression, projectedRow: AliasedRow, context: { row: AliasedRow; group?: Group }) {
  if (expression.type === 'column' && !expression.tableAlias && expression.column in projectedRow.values) {
    return projectedRow.values[expression.column]
  }
  return evaluateExpression(expression, context.row, context.group)
}

function wildcardEntries(row: AliasedRow): [string, Scalar][] {
  const entries = Object.entries(row.values)
  const aliases = new Set(entries.map(([key]) => key.split('.')[0]))
  if (aliases.size !== 1) return entries

  const unqualified = entries.map(([key, value]) => [key.split('.').slice(1).join('.'), value] as [string, Scalar])
  const columnNames = unqualified.map(([key]) => key)
  if (new Set(columnNames).size !== columnNames.length) return entries
  return unqualified
}

function markRemoved(before: AliasedRow[], kept: AliasedRow[]): AliasedRow[] {
  const keptIds = new Set(kept.map((row) => row.id))
  return before.map((row) => (keptIds.has(row.id) ? row : { ...row, id: `${row.id}__removed` }))
}
