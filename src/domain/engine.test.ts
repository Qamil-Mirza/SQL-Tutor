import { describe, expect, it } from 'vitest'
import { executeQuery } from './engine'
import { parseQuery } from './parser'
import { initialTables } from './samples'
import type { Table } from './types'

function rowsFor(sql: string) {
  const steps = executeQuery(parseQuery(sql), initialTables)
  return steps.at(-1)!.after
}

describe('executeQuery', () => {
  it('aliases and filters rows', () => {
    const rows = rowsFor("SELECT u.name FROM users AS u WHERE u.tier = 'pro'")
    expect(rows).toHaveLength(2)
    expect(rows[0].values['u.name']).toBe('Ada')
  })

  it('joins rows', () => {
    const rows = rowsFor('SELECT u.name, l.artist FROM users AS u JOIN listening AS l ON u.id = l.user_id WHERE l.minutes > 40')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.values['u.name'])).toEqual(['Ada', 'Chen'])
  })

  it('supports self joins', () => {
    const rows = rowsFor('SELECT e.name AS employee, m.name AS manager FROM employees AS e JOIN employees AS m ON e.manager_id = m.id')
    expect(rows).toHaveLength(3)
    expect(rows[0].values.manager).toBe('Priya')
  })

  it('groups, filters groups with having, and projects aggregates', () => {
    const rows = rowsFor(
      'SELECT u.tier, COUNT(*) AS plays, SUM(l.minutes) AS minutes FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].values.plays).toBe(3)
    expect(rows[0].values.minutes).toBe(165)
  })

  it('applies limit after projection', () => {
    const rows = rowsFor('SELECT u.name FROM users AS u LIMIT 2')
    expect(rows.map((row) => row.values['u.name'])).toEqual(['Ada', 'Ben'])
  })

  it('projects every column for wildcard selects', () => {
    const mentors: Table[] = [
      {
        name: 'mentors',
        columns: ['name', 'food', 'color', 'editor', 'language'],
        rows: [
          { name: 'Chi', food: 'Thai', color: 'Purple', editor: 'Notepad++', language: 'Java' },
          { name: 'Kaitlyn', food: 'Pie', color: 'Green', editor: 'Sublime', language: 'Java' },
        ],
      },
    ]

    const steps = executeQuery(parseQuery('SELECT * FROM mentors'), mentors)
    const rows = steps.at(-1)!.after

    expect(rows).toHaveLength(2)
    expect(rows[0].values).toEqual({
      name: 'Chi',
      food: 'Thai',
      color: 'Purple',
      editor: 'Notepad++',
      language: 'Java',
    })
  })

  it('filters wildcard selects with double-quoted string literals', () => {
    const mentors: Table[] = [
      {
        name: 'mentors',
        columns: ['name', 'food', 'color', 'editor', 'language'],
        rows: [
          { name: 'Chi', food: 'Thai', color: 'Purple', editor: 'Notepad++', language: 'Java' },
          { name: 'Ada', food: 'Tacos', color: 'Blue', editor: 'Vim', language: 'Python' },
          { name: 'Lukas', food: 'Ramen', color: 'Green', editor: 'Vim', language: 'Python' },
        ],
      },
    ]

    const steps = executeQuery(parseQuery('SELECT * FROM mentors WHERE editor = "Vim"'), mentors)
    const rows = steps.at(-1)!.after

    expect(rows.map((row) => row.values.name)).toEqual(['Ada', 'Lukas'])
  })

  it('compares strings lexicographically in conditions', () => {
    const mentors: Table[] = [
      {
        name: 'mentors',
        columns: ['name', 'food', 'color', 'editor', 'language'],
        rows: [
          { name: 'Chi', food: 'Thai', color: 'Purple', editor: 'Notepad++', language: 'Java' },
          { name: 'Kaitlyn', food: 'Pie', color: 'Green', editor: 'Sublime', language: 'Java' },
          { name: 'Nick', food: 'Sushi', color: 'Orange', editor: 'Emacs', language: 'Ruby' },
          { name: 'Ada', food: 'Tacos', color: 'Blue', editor: 'Vim', language: 'Python' },
          { name: 'Lukas', food: 'Ramen', color: 'Green', editor: 'Vim', language: 'Python' },
        ],
      },
    ]

    const steps = executeQuery(
      parseQuery('SELECT m1.name, m2.name FROM mentors AS m1 JOIN mentors AS m2 ON m1.language = m2.language WHERE m1.name > m2.name'),
      mentors,
    )
    const rows = steps.at(-1)!.after

    expect(rows.map((row) => [row.values['m1.name'], row.values['m2.name']])).toEqual([
      ['Kaitlyn', 'Chi'],
      ['Lukas', 'Ada'],
    ])
  })

  it('supports comma self joins filtered by where conditions', () => {
    const mentors: Table[] = [
      {
        name: 'mentors',
        columns: ['name', 'food', 'color', 'editor', 'language'],
        rows: [
          { name: 'Chi', food: 'Thai', color: 'Purple', editor: 'Notepad++', language: 'Java' },
          { name: 'Kaitlyn', food: 'Pie', color: 'Green', editor: 'Sublime', language: 'Java' },
          { name: 'Nick', food: 'Sushi', color: 'Orange', editor: 'Emacs', language: 'Ruby' },
          { name: 'Ada', food: 'Tacos', color: 'Blue', editor: 'Vim', language: 'Python' },
          { name: 'Lukas', food: 'Ramen', color: 'Green', editor: 'Vim', language: 'Python' },
        ],
      },
    ]

    const steps = executeQuery(
      parseQuery('SELECT m1.name, m2.name FROM mentors AS m1, mentors as m2 WHERE m1.name > m2.name AND m1.language = m2.language'),
      mentors,
    )
    const rows = steps.at(-1)!.after

    expect(rows.map((row) => [row.values['m1.name'], row.values['m2.name']])).toEqual([
      ['Kaitlyn', 'Chi'],
      ['Lukas', 'Ada'],
    ])
  })

  it('explains both sources when visualizing comma joins', () => {
    const mentors: Table[] = [
      {
        name: 'mentors',
        columns: ['name', 'language'],
        rows: [
          { name: 'Chi', language: 'Java' },
          { name: 'Kaitlyn', language: 'Java' },
        ],
      },
    ]

    const steps = executeQuery(parseQuery('SELECT m1.name, m2.name FROM mentors AS m1, mentors as m2 WHERE m1.name > m2.name'), mentors)

    expect(steps[0].explanation).toBe('Start with every row from mentors as m1 and mentors as m2.')
    expect(steps[0].details).toEqual(['2 row(s) from m1.', '2 row(s) from m2.'])
    expect(steps[1].explanation).toBe('Pair every row from m1 with every row from m2.')
  })

  it('visualizes each AND condition as a separate where step', () => {
    const mentors: Table[] = [
      {
        name: 'mentors',
        columns: ['name', 'language'],
        rows: [
          { name: 'Chi', language: 'Java' },
          { name: 'Kaitlyn', language: 'Java' },
          { name: 'Ada', language: 'Python' },
          { name: 'Lukas', language: 'Python' },
        ],
      },
    ]

    const steps = executeQuery(
      parseQuery('SELECT m1.name, m2.name FROM mentors AS m1, mentors as m2 WHERE m1.name > m2.name AND m1.language = m2.language'),
      mentors,
    )
    const whereSteps = steps.filter((step) => step.kind === 'where')

    expect(whereSteps.map((step) => step.id)).toEqual(['where-1', 'where-2'])
    expect(whereSteps.map((step) => step.details)).toEqual([['m1.name > m2.name'], ['m1.language = m2.language']])
    expect(whereSteps[0].before).toHaveLength(16)
    expect(whereSteps[0].after).toHaveLength(16)
    expect(whereSteps[1].before).toHaveLength(6)
    expect(whereSteps[1].after).toHaveLength(6)
    expect(steps.at(-1)!.after).toHaveLength(2)
  })
})
