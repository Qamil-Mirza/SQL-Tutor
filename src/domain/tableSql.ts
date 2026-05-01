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
  const statements = input
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
  const tables = new Map<string, Table>()

  for (const statement of statements) {
    const create = statement.match(/^CREATE\s+TABLE\s+([a-z_][\w]*)\s*\((.+)\)$/i)
    if (create) {
      const columns = splitComma(create[2]).map((part) => part.trim().split(/\s+/)[0]).filter(Boolean)
      if (!columns.length) throw new TableDefinitionError(`Table "${create[1]}" needs at least one column.`)
      tables.set(create[1], { name: create[1], columns, rows: [] })
      continue
    }

    const insert = statement.match(/^INSERT\s+INTO\s+([a-z_][\w]*)\s+VALUES\s*\((.+)\)$/i)
    if (insert) {
      const table = tables.get(insert[1])
      if (!table) throw new TableDefinitionError(`INSERT references unknown table "${insert[1]}". Define it with CREATE TABLE first.`)
      const values = splitComma(insert[2]).map(parseValue)
      if (values.length !== table.columns.length) {
        throw new TableDefinitionError(`INSERT into "${table.name}" has ${values.length} values but ${table.columns.length} columns.`)
      }
      table.rows.push(Object.fromEntries(table.columns.map((column, index) => [column, values[index]])) as Row)
      continue
    }

    throw new TableDefinitionError(`Unsupported table statement: ${statement}. Use CREATE TABLE and INSERT INTO ... VALUES.`)
  }

  return [...tables.values()]
}

function parseValue(value: string): Scalar {
  const trimmed = value.trim()
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1)
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (/^null$/i.test(trimmed)) return null
  return trimmed
}

function formatValue(value: Scalar) {
  if (value === null) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

function splitComma(text: string) {
  const parts: string[] = []
  let inQuote = false
  let current = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === "'") inQuote = !inQuote
    if (char === ',' && !inQuote) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}
