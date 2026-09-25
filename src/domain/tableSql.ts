import { isQuotedString, maskStrings, splitOutsideStrings, splitTopLevel, unquoteString } from './sqlText'
import type { Row, Scalar, Table } from './types'

export class TableDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TableDefinitionError'
  }
}

export function serializeTables(tables: Table[]) {
  return tables
    .map((table) => {
      const create = `CREATE TABLE ${table.name} (${table.columns.join(', ')});`
      const inserts = table.rows.map((row) => (
        `INSERT INTO ${table.name} VALUES (${table.columns.map((column) => formatValue(row[column])).join(', ')});`
      ))
      return [create, ...inserts].join('\n')
    })
    .join('\n\n')
}

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

function formatValue(value: Scalar) {
  if (value === null) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
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
    if (depth === 0 && !/\s|,/.test(char)) {
      throw new TableDefinitionError(`Unsupported INSERT values: ${text.trim()}. Use parenthesized row values.`)
    }
  }
  if (depth !== 0) throw new TableDefinitionError(`Unsupported INSERT values: ${text.trim()}. Check parentheses and quotes.`)
  return rows
}
