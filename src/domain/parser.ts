import type {
  AggregateName,
  ComparisonOperator,
  Condition,
  Expression,
  QueryAST,
  SelectItem,
} from './types'

const clausePattern = /\b(FROM|JOIN|ON|WHERE|GROUP BY|HAVING|LIMIT|ORDER BY|DISTINCT|UNION|WITH)\b/gi
const unsupportedClausePattern = /\b(ORDER BY|DISTINCT|UNION|WITH|OVER|RIGHT JOIN|LEFT JOIN|FULL JOIN|CROSS JOIN)\b/i
const comparisonPattern = /^(.+?)\s*(>=|<=|<>|!=|=|>|<)\s*(.+)$/i

export class QueryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryParseError'
  }
}

export function parseQuery(input: string): QueryAST {
  const sql = input.trim().replace(/;$/, '').replace(/\s+/g, ' ')
  if (!sql) throw new QueryParseError('Enter a SELECT query to visualize.')
  if (!/^SELECT\b/i.test(sql)) throw new QueryParseError('Only SELECT queries are supported.')
  const unsupported = sql.match(unsupportedClausePattern)
  if (unsupported) throw new QueryParseError(`${unsupported[1].toUpperCase()} is not supported in this visualizer.`)

  const clauses = collectClauses(sql)
  const selectText = sql.slice('SELECT '.length, clauses.FROM?.start).trim()
  if (!selectText || !clauses.FROM) throw new QueryParseError('Queries must include SELECT columns and a FROM table alias.')

  const fromSources = splitComma(textForClause(sql, clauses, 'FROM'))
  if (fromSources.length > 2) throw new QueryParseError('Only one joined table is supported.')
  if (fromSources.length > 1 && clauses.JOIN) throw new QueryParseError('Use either comma join syntax or JOIN syntax, not both.')
  const fromSource = parseTableSource(fromSources[0], false)

  const joinText = clauses.JOIN ? textForClause(sql, clauses, 'JOIN') : undefined
  const onText = clauses.ON ? textForClause(sql, clauses, 'ON') : undefined
  let join: QueryAST['join']
  if (fromSources[1]) {
    join = { ...parseTableSource(fromSources[1], true), syntax: 'comma' }
  }
  if (joinText || onText) {
    const joinSource = joinText ? parseTableSource(joinText, true) : undefined
    if (!joinSource || !onText) throw new QueryParseError('JOIN must use: JOIN table AS alias ON alias.column = alias.column.')
    join = {
      ...joinSource,
      condition: parseCondition(onText),
      syntax: 'explicit',
    }
  }

  const limitText = clauses.LIMIT ? textForClause(sql, clauses, 'LIMIT') : undefined
  let parsedLimit: number | undefined
  if (limitText !== undefined) {
    parsedLimit = Number(limitText)
    if (!Number.isInteger(parsedLimit) || parsedLimit < 0) {
      throw new QueryParseError('LIMIT must be a non-negative whole number.')
    }
  }

  return {
    select: splitComma(selectText).map(parseSelectItem),
    from: fromSource,
    join,
    where: clauses.WHERE ? parseConditions(textForClause(sql, clauses, 'WHERE')) : [],
    groupBy: clauses['GROUP BY'] ? splitComma(textForClause(sql, clauses, 'GROUP BY')).map(parseExpression) : [],
    having: clauses.HAVING ? parseConditions(textForClause(sql, clauses, 'HAVING')) : [],
    limit: parsedLimit,
  }
}

function parseTableSource(text: string, requireAlias: boolean) {
  const match = text.trim().match(/^([a-z_][\w]*)(?:\s+AS\s+([a-z_][\w]*))?$/i)
  if (!match) throw new QueryParseError('FROM must use the form: FROM table or FROM table AS alias.')
  if (requireAlias && !match[2]) throw new QueryParseError('Joined tables must use the form: table AS alias.')
  return { tableName: match[1], alias: match[2] ?? match[1] }
}

function collectClauses(sql: string) {
  const found: Record<string, { start: number; end: number }> = {}
  for (const match of sql.matchAll(clausePattern)) {
    const name = match[1].toUpperCase()
    found[name] = { start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }
  }
  return found
}

function textForClause(sql: string, clauses: Record<string, { start: number; end: number }>, name: string) {
  const clause = clauses[name]
  const next = Object.values(clauses)
    .filter((candidate) => candidate.start > clause.start)
    .sort((a, b) => a.start - b.start)[0]
  return sql.slice(clause.end, next?.start ?? sql.length).trim()
}

function parseConditions(text: string): Condition[] {
  return text.split(/\s+AND\s+/i).map(parseCondition)
}

function parseCondition(text: string): Condition {
  const match = text.trim().match(comparisonPattern)
  if (!match) throw new QueryParseError(`Unsupported condition: ${text}. Use a simple comparison joined with AND.`)
  return {
    left: parseExpression(match[1]),
    operator: match[2] as ComparisonOperator,
    right: parseExpression(match[3]),
    label: text.trim(),
  }
}

function parseSelectItem(text: string): SelectItem {
  const match = text.trim().match(/^(.+?)(?:\s+AS\s+([a-z_][\w]*))?$/i)
  if (!match) throw new QueryParseError(`Unsupported SELECT expression: ${text}.`)
  const expression = parseExpression(match[1])
  return { expression, alias: match[2], label: text.trim() }
}

function parseExpression(text: string): Expression {
  const value = text.trim()
  if (value === '*') return { type: 'wildcard', label: '*' }
  const aggregate = value.match(/^(COUNT|SUM|AVG|MIN|MAX)\((\*|.+)\)$/i)
  if (aggregate) {
    const fn = aggregate[1].toUpperCase() as AggregateName
    return { type: 'aggregate', fn, column: aggregate[2] === '*' ? undefined : parseExpression(aggregate[2]), label: value }
  }
  if (/^'.*'$/.test(value) || /^".*"$/.test(value)) return { type: 'literal', value: value.slice(1, -1), label: value }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return { type: 'literal', value: Number(value), label: value }
  if (/^null$/i.test(value)) return { type: 'literal', value: null, label: value }
  const column = value.match(/^(?:(\w+)\.)?(\w+)$/)
  if (column) return { type: 'column', tableAlias: column[1], column: column[2], label: value }
  throw new QueryParseError(`Unsupported expression: ${value}.`)
}

function splitComma(text: string) {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}
