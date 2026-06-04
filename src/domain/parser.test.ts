import { describe, expect, it } from 'vitest'
import { parseQuery } from './parser'

describe('parseQuery', () => {
  it('parses select, aliases, where, and limit', () => {
    const ast = parseQuery("SELECT u.name, u.tier FROM users AS u WHERE u.tier = 'pro' LIMIT 2")
    expect(ast.from).toEqual({ tableName: 'users', alias: 'u' })
    expect(ast.where).toHaveLength(1)
    expect(ast.limit).toBe(2)
  })

  it('parses joins and aggregates', () => {
    const ast = parseQuery(
      'SELECT u.tier, COUNT(*) AS plays, SUM(l.minutes) AS minutes FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80',
    )
    expect(ast.join?.alias).toBe('l')
    expect(ast.select[1].expression.type).toBe('aggregate')
    expect(ast.groupBy).toHaveLength(1)
    expect(ast.having).toHaveLength(1)
  })

  it('parses table aliases without AS', () => {
    const ast = parseQuery(
      'SELECT employee.name, manager.name FROM employees employee JOIN employees manager ON employee.manager_id = manager.id',
    )
    expect(ast.from).toEqual({ tableName: 'employees', alias: 'employee' })
    expect(ast.join).toEqual({
      tableName: 'employees',
      alias: 'manager',
      condition: {
        left: { type: 'column', tableAlias: 'employee', column: 'manager_id', label: 'employee.manager_id' },
        operator: '=',
        right: { type: 'column', tableAlias: 'manager', column: 'id', label: 'manager.id' },
        label: 'employee.manager_id = manager.id',
      },
      syntax: 'explicit',
    })
  })

  it('still requires a joined table alias when the same table name would be reused', () => {
    expect(() => parseQuery('SELECT employees.name FROM employees JOIN employees ON employees.manager_id = employees.id')).toThrow(/Joined tables must use/)
  })

  it('parses order by expressions and directions', () => {
    const ast = parseQuery('SELECT u.tier FROM users AS u GROUP BY u.tier ORDER BY COUNT(*) DESC, u.tier ASC LIMIT 1')
    expect(ast.orderBy).toEqual([
      { expression: { type: 'aggregate', fn: 'COUNT', column: undefined, label: 'COUNT(*)' }, direction: 'DESC', label: 'COUNT(*) DESC' },
      { expression: { type: 'column', tableAlias: 'u', column: 'tier', label: 'u.tier' }, direction: 'ASC', label: 'u.tier ASC' },
    ])
  })

  it('parses arithmetic expressions around aggregates', () => {
    const ast = parseQuery('SELECT Location, AVG(Minutes) / 60.0 AS Avg_Hours FROM User_Data GROUP BY Location ORDER BY Avg_Hours DESC')
    expect(ast.select[1]).toEqual({
      expression: {
        type: 'binary',
        operator: '/',
        left: { type: 'aggregate', fn: 'AVG', column: { type: 'column', tableAlias: undefined, column: 'Minutes', label: 'Minutes' }, label: 'AVG(Minutes)' },
        right: { type: 'literal', value: 60, label: '60.0' },
        label: 'AVG(Minutes) / 60.0',
      },
      alias: 'Avg_Hours',
      label: 'AVG(Minutes) / 60.0 AS Avg_Hours',
    })
  })

  it('parses wildcard select with an implicit table alias', () => {
    const ast = parseQuery('SELECT * FROM mentors')
    expect(ast.from).toEqual({ tableName: 'mentors', alias: 'mentors' })
    expect(ast.select[0]).toEqual({
      expression: { type: 'wildcard', label: '*' },
      alias: undefined,
      label: '*',
    })
  })

  it('parses comma joins in the from clause', () => {
    const ast = parseQuery('SELECT m1.name, m2.name FROM mentors AS m1, mentors as m2 WHERE m1.name > m2.name')
    expect(ast.from).toEqual({ tableName: 'mentors', alias: 'm1' })
    expect(ast.join).toEqual({ tableName: 'mentors', alias: 'm2', syntax: 'comma' })
    expect(ast.where).toHaveLength(1)
  })

  it('parses double-quoted string literals in conditions', () => {
    const ast = parseQuery('SELECT * FROM mentors WHERE editor = "Vim"')
    expect(ast.where[0].right).toEqual({ type: 'literal', value: 'Vim', label: '"Vim"' })
  })

  it('requires join aliases', () => {
    expect(() => parseQuery('SELECT users.name FROM users JOIN listening ON users.id = listening.user_id')).toThrow(/Joined tables must use/)
  })

  it('rejects unsupported clauses', () => {
    expect(() => parseQuery('SELECT DISTINCT u.name FROM users AS u')).toThrow(/DISTINCT/)
  })
})
