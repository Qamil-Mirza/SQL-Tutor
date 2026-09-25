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
})
