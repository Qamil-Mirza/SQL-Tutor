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
  if (isWrappedInParentheses(value)) {
    const inner = parseExpression(value.slice(1, -1))
    if (inner.type === 'wildcard') throw new QueryParseError(`Unsupported expression: ${value}.`)
    return { ...inner, label: value }
  }
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
