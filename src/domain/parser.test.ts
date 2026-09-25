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

  it('parses explicit join conditions joined with AND', () => {
    const ast = parseQuery(
      'SELECT s.name, a.name FROM staff AS s JOIN apartments AS a ON s.location = a.location AND s.single = a.single',
    )
    expect(ast.join?.conditions).toEqual([
      {
        left: { type: 'column', tableAlias: 's', column: 'location', label: 's.location' },
        operator: '=',
        right: { type: 'column', tableAlias: 'a', column: 'location', label: 'a.location' },
        label: 's.location = a.location',
      },
      {
        left: { type: 'column', tableAlias: 's', column: 'single', label: 's.single' },
        operator: '=',
        right: { type: 'column', tableAlias: 'a', column: 'single', label: 'a.single' },
        label: 's.single = a.single',
      },
    ])
  })

  it('parses table aliases without AS', () => {
    const ast = parseQuery(
      'SELECT employee.name, manager.name FROM employees employee JOIN employees manager ON employee.manager_id = manager.id',
    )
    expect(ast.from).toEqual({ tableName: 'employees', alias: 'employee' })
    expect(ast.join).toEqual({
      tableName: 'employees',
      alias: 'manager',
      conditions: [
        {
          left: { type: 'column', tableAlias: 'employee', column: 'manager_id', label: 'employee.manager_id' },
          operator: '=',
          right: { type: 'column', tableAlias: 'manager', column: 'id', label: 'manager.id' },
          label: 'employee.manager_id = manager.id',
        },
      ],
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
    expect(ast.join).toEqual({ tableName: 'mentors', alias: 'm2', conditions: [], syntax: 'comma' })
    expect(ast.where).toHaveLength(1)
  })

  it('parses comma joins that use table names as implicit aliases', () => {
    const ast = parseQuery(
      'SELECT animals.sound, COUNT(*) FROM friends, animals WHERE friends.animal = animals.animal GROUP BY animals.sound ORDER BY COUNT(*) ASC',
    )
    expect(ast.from).toEqual({ tableName: 'friends', alias: 'friends' })
    expect(ast.join).toEqual({ tableName: 'animals', alias: 'animals', conditions: [], syntax: 'comma' })
    expect(ast.where[0].label).toBe('friends.animal = animals.animal')
    expect(ast.groupBy).toHaveLength(1)
    expect(ast.orderBy[0].label).toBe('COUNT(*) ASC')
  })

  it('requires comma-joined self joins to use aliases', () => {
    expect(() => parseQuery('SELECT mentors.name FROM mentors, mentors WHERE mentors.name = mentors.name')).toThrow(/Joined tables must use/)
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

  it('records raw clause text for highlighting', () => {
    const ast = parseQuery("select u.name from users u join listening l on u.id = l.user_id where l.minutes > 20 group by u.name having count(*) > 1 order by u.name limit 3")
    expect(ast.clauses).toEqual({
      select: 'select u.name',
      from: 'from users u',
      join: 'join listening l on u.id = l.user_id',
      where: 'where l.minutes > 20',
      groupBy: 'group by u.name',
      having: 'having count(*) > 1',
      orderBy: 'order by u.name',
      limit: 'limit 3',
    })
  })

  it('ignores keywords and AND inside string literals', () => {
    const ast = parseQuery("SELECT name FROM dogs WHERE fur = 'FROM' AND kind = 'a AND b'")
    expect(ast.where.map((condition) => condition.right)).toEqual([
      { type: 'literal', value: 'FROM', label: "'FROM'" },
      { type: 'literal', value: 'a AND b', label: "'a AND b'" },
    ])
  })

  it('unescapes doubled single quotes in literals', () => {
    const ast = parseQuery("SELECT name FROM dogs WHERE name = 'o''neil'")
    expect(ast.where[0].right).toEqual({ type: 'literal', value: "o'neil", label: "'o''neil'" })
  })

  it('enforces clause order', () => {
    expect(() => parseQuery('SELECT name FROM dogs LIMIT 2 ORDER BY name')).toThrow('ORDER BY must come before LIMIT.')
    expect(() => parseQuery('SELECT fur FROM dogs GROUP BY fur WHERE height > 3')).toThrow('WHERE must come before GROUP BY.')
    expect(() => parseQuery('SELECT name FROM dogs WHERE a = 1 WHERE b = 2')).toThrow('WHERE appears more than once.')
  })

  it('parses IS NULL and IS NOT NULL', () => {
    const ast = parseQuery('SELECT name FROM employees WHERE manager_id IS NULL AND name IS NOT NULL')
    expect(ast.where.map((condition) => condition.operator)).toEqual(['IS', 'IS NOT'])
    expect(ast.where[0].right).toEqual({ type: 'literal', value: null, label: 'NULL' })
  })

  it('parses parentheses in arithmetic', () => {
    const ast = parseQuery('SELECT (height + 1) * 2 AS h FROM dogs')
    const expression = ast.select[0].expression
    expect(expression.type).toBe('binary')
    if (expression.type !== 'binary') return
    expect(expression.operator).toBe('*')
    expect(expression.left).toMatchObject({ type: 'binary', operator: '+' })
  })

  it('rejects a parenthesised wildcard', () => {
    expect(() => parseQuery('SELECT (*) FROM dogs')).toThrow('Unsupported expression: (*).')
  })

  it('rejects aggregates in WHERE and nested aggregates with clear messages', () => {
    expect(() => parseQuery('SELECT name FROM dogs WHERE height > AVG(height)')).toThrow(
      "AVG(height) can't be used in WHERE because aggregates need groups. Use HAVING.",
    )
    expect(() => parseQuery('SELECT MAX(COUNT(*)) FROM dogs')).toThrow("Aggregates can't be nested: MAX(COUNT(*)).")
  })

  it('names unsupported operators and OFFSET', () => {
    expect(() => parseQuery("SELECT name FROM dogs WHERE fur IN ('long')")).toThrow('IN is not supported in this visualizer.')
    expect(() => parseQuery('SELECT name FROM dogs WHERE height BETWEEN 1 AND 2')).toThrow('BETWEEN is not supported in this visualizer.')
    expect(() => parseQuery("SELECT name FROM dogs WHERE name LIKE 'a%'")).toThrow('LIKE is not supported in this visualizer.')
    expect(() => parseQuery("SELECT name FROM dogs WHERE NOT fur = 'long'")).toThrow('NOT is not supported in this visualizer.')
    expect(() => parseQuery('SELECT name FROM dogs LIMIT 2 OFFSET 1')).toThrow('OFFSET is not supported in this visualizer.')
  })

  it('keeps ORDER BY integer literals so the engine can sort by position', () => {
    const ast = parseQuery('SELECT name, height FROM dogs ORDER BY 2 DESC')
    expect(ast.orderBy[0].expression).toEqual({ type: 'literal', value: 2, label: '2' })
    expect(ast.orderBy[0].direction).toBe('DESC')
  })
})
