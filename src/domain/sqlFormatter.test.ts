import { describe, expect, it } from 'vitest'
import { formatSql } from './sqlFormatter'

describe('formatSql', () => {
  it('formats a SELECT query using supported clauses', () => {
    expect(
      formatSql(
        'select s.name as staff_name, s.in_state as in_state, a.name as apartment_name, s.budget - a.rent as budget_surplus from staff as s join apartments as a on s.location = a.location and s.single = a.single where s.budget - a.rent >= 0 order by staff_name asc, budget_surplus desc',
      ),
    ).toBe([
      'SELECT s.name AS staff_name, s.in_state AS in_state, a.name AS apartment_name, s.budget - a.rent AS budget_surplus',
      'FROM staff AS s',
      'JOIN apartments AS a',
      'ON s.location = a.location AND s.single = a.single',
      'WHERE s.budget - a.rent >= 0',
      'ORDER BY staff_name ASC, budget_surplus DESC',
    ].join('\n'))
  })

  it('formats table creation statements on separate lines', () => {
    expect(formatSql("create table pets (id, name); insert into pets values (1, 'Miso');")).toBe([
      'CREATE TABLE pets (id, name);',
      "INSERT INTO pets VALUES (1, 'Miso');",
    ].join('\n'))
  })

  it('preserves words inside string literals', () => {
    expect(formatSql("select name from pets where note = 'select from where and order by'")).toBe([
      'SELECT name',
      'FROM pets',
      "WHERE note = 'select from where and order by'",
    ].join('\n'))
  })
})
