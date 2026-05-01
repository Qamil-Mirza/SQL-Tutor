import { describe, expect, it } from 'vitest'
import { parseTableSql, serializeTables } from './tableSql'

describe('table SQL helpers', () => {
  it('parses CREATE TABLE and INSERT statements', () => {
    const tables = parseTableSql("CREATE TABLE pets (id, name);\nINSERT INTO pets VALUES (1, 'Miso');")
    expect(tables).toEqual([
      {
        name: 'pets',
        columns: ['id', 'name'],
        rows: [{ id: 1, name: 'Miso' }],
      },
    ])
  })

  it('serializes editable tables back to SQL', () => {
    expect(serializeTables([{ name: 'pets', columns: ['id', 'name'], rows: [{ id: 1, name: 'Miso' }] }]))
      .toContain("INSERT INTO pets VALUES (1, 'Miso');")
  })

  it('rejects unsupported table statements', () => {
    expect(() => parseTableSql('DROP TABLE pets;')).toThrow(/Unsupported table statement/)
  })
})
