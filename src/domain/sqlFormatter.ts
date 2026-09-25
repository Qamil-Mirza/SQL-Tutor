import { maskStrings, replaceOutsideStrings, splitOutsideStrings, splitTopLevel } from './sqlText'

const keywordPattern = /\b(CREATE|TABLE|INSERT|INTO|VALUES|SELECT|FROM|JOIN|ON|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|AS|AND|ASC|DESC|TRUE|FALSE|NULL)\b/gi
const clausePattern = /\b(FROM|JOIN|ON|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT)\b/gi
const alignedClausePattern = /^(SELECT|FROM|JOIN|ON|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|AND)\b\s*(.*)$/i
const clauseIndents: Record<string, string> = {
  SELECT: '',
  FROM: '  ',
  JOIN: '  ',
  ON: '    ',
  WHERE: ' ',
  'GROUP BY': '',
  HAVING: '  ',
  'ORDER BY': '',
  LIMIT: ' ',
  AND: '   ',
}

export function formatSql(input: string) {
  const statements = splitStatements(input)
  if (!statements.length) return ''

  const formatted = statements.map((statement) => formatStatement(statement.text, shouldTerminate(statement.text, statements.length, statement.hadTerminator)))
  return formatted.join('\n')
}

function shouldTerminate(statement: string, statementCount: number, hadTerminator: boolean) {
  if (statementCount > 1 || hadTerminator) return true
  return /^(CREATE|INSERT)\b/i.test(statement.trim())
}

function formatStatement(statement: string, terminate: boolean) {
  const normalized = uppercaseKeywords(normalizeWhitespace(statement))
  const formatted = formatNormalizedStatement(normalized)
  return terminate ? `${formatted};` : formatted
}

function formatNormalizedStatement(statement: string) {
  if (/^SELECT\b/i.test(statement)) return breakSelectClauses(statement)
  if (/^CREATE\s+TABLE\b/i.test(statement)) return formatCreateTable(statement)
  if (/^INSERT\s+INTO\b/i.test(statement)) return formatInsert(statement)
  return statement
}

function normalizeWhitespace(text: string) {
  return replaceOutsideStrings(text.trim(), /\s+/g, () => ' ')
}

function uppercaseKeywords(text: string) {
  return replaceOutsideStrings(text, keywordPattern, (keyword) => keyword.toUpperCase().replace(/\s+/g, ' '))
}

function breakSelectClauses(text: string) {
  return replaceOutsideStrings(text, clausePattern, (keyword) => `\n${keyword.toUpperCase().replace(/\s+/g, ' ')}`)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(splitAndConditions)
    .map(alignClauseLine)
    .join('\n')
}

function alignClauseLine(line: string) {
  const match = line.match(alignedClausePattern)
  if (!match) return line
  const label = match[1].toUpperCase()
  const body = match[2].trim()
  const indent = clauseIndents[label] ?? ''
  return body ? `${indent}${label} ${body}` : `${indent}${label}`
}

function splitAndConditions(line: string) {
  if (!/^(ON|WHERE|HAVING)\b/i.test(line)) return [line]
  return replaceOutsideStrings(line, /\s+AND\s+/gi, () => '\nAND ')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
}

function formatCreateTable(statement: string) {
  const match = statement.match(/^CREATE\s+TABLE\s+([a-z_][\w]*)\s*\((.*)\)$/is)
  if (!match) return statement
  const columns = splitTopLevel(match[2])
  if (!columns.length) return statement
  const columnLines = columns.map((column, index) => `    ${column.trim()}${index < columns.length - 1 ? ',' : ''}`)
  return [`CREATE TABLE ${match[1]} (`, ...columnLines, ')'].join('\n')
}

function formatInsert(statement: string) {
  const match = statement.match(/^(INSERT\s+INTO\s+[a-z_][\w]*)\s+VALUES\s+(.+)$/is)
  if (!match) return statement
  const rows = splitInsertRows(match[2])
  if (!rows.length) return statement
  const valueLines = rows.map((row, index) => `${index === 0 ? 'VALUES ' : '       '}(${row})${index < rows.length - 1 ? ',' : ''}`)
  return [match[1], ...valueLines].join('\n')
}

function splitStatements(text: string) {
  const parts = splitOutsideStrings(text, /;/)
  return parts
    .map((part, index) => ({ text: part.trim(), hadTerminator: index < parts.length - 1 }))
    .filter((statement) => statement.text)
}

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
  }
  return rows
}

