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

  it('parses multi-row INSERT statements with typed CREATE TABLE columns', () => {
    const tables = parseTableSql(`
      CREATE TABLE User_Data (
        User_ID TEXT PRIMARY KEY,
        Location TEXT,
        Minutes INTEGER,
        Top_Genre TEXT,
        Top_Artist TEXT
      );

      INSERT INTO User_Data VALUES
      ('tiffany123', 'Berkeley', 2434, 'Pop', 'Olivia Rodrigo'),
      ('aidan456', 'Oakland', 1800, 'Afrobeats', 'Burna Boy'),
      ('colleen789', 'San Jose', 3200, 'Flamenco', 'ROSALÍA');
    `)

    expect(tables).toEqual([
      {
        name: 'User_Data',
        columns: ['User_ID', 'Location', 'Minutes', 'Top_Genre', 'Top_Artist'],
        rows: [
          { User_ID: 'tiffany123', Location: 'Berkeley', Minutes: 2434, Top_Genre: 'Pop', Top_Artist: 'Olivia Rodrigo' },
          { User_ID: 'aidan456', Location: 'Oakland', Minutes: 1800, Top_Genre: 'Afrobeats', Top_Artist: 'Burna Boy' },
          { User_ID: 'colleen789', Location: 'San Jose', Minutes: 3200, Top_Genre: 'Flamenco', Top_Artist: 'ROSALÍA' },
        ],
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
