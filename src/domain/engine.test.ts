import { describe, expect, it } from 'vitest'
import { executeQuery } from './engine'
import { parseQuery } from './parser'
import { initialTables } from './samples'
import type { Group, Table } from './types'

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

  it('highlights columns added by a joined table', () => {
    const steps = executeQuery(parseQuery('SELECT u.name, l.artist FROM users AS u JOIN listening AS l ON u.id = l.user_id'), initialTables)
    const joinStep = steps.find((step) => step.kind === 'join')

    expect(joinStep?.highlights).toContainEqual({
      kind: 'selected',
      columnKeys: ['l.id', 'l.user_id', 'l.artist', 'l.minutes'],
    })
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

  it('adds aggregate summaries to groups for select and having expressions', () => {
    const steps = executeQuery(
      parseQuery('SELECT u.tier, COUNT(*) AS plays, SUM(l.minutes) AS minutes FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80'),
      initialTables,
    )
    const groupStep = steps.find((step) => step.kind === 'groupBy')!
    const proGroup = groupStep.after.find((group) => 'rows' in group && group.key === 'pro') as Group | undefined

    expect(proGroup?.aggregates).toEqual([
      { label: 'COUNT(*)', value: 3 },
      { label: 'SUM(l.minutes)', value: 165 },
    ])
  })

  it('adds having condition evaluations to groups', () => {
    const steps = executeQuery(
      parseQuery('SELECT u.tier, COUNT(*) AS plays, SUM(l.minutes) AS minutes FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80'),
      initialTables,
    )
    const havingStep = steps.find((step) => step.kind === 'having')!
    const removedGroup = havingStep.before?.find((group) => 'rows' in group && group.key === 'free') as Group | undefined

    expect(removedGroup?.conditions).toEqual([
      { label: 'SUM(l.minutes) > 80', result: false },
    ])
  })

  it('applies limit after projection', () => {
    const rows = rowsFor('SELECT u.name FROM users AS u LIMIT 2')
    expect(rows.map((row) => row.values['u.name'])).toEqual(['Ada', 'Ben'])
  })

  it('orders grouped results by an aggregate before applying limit', () => {
    const musicTables: Table[] = [
      {
        name: 'User_Data',
        columns: ['User_ID', 'Location', 'Minutes', 'Top_Genre', 'Top_Artist'],
        rows: [
          { User_ID: 'tiffany123', Location: 'Berkeley', Minutes: 2434, Top_Genre: 'Pop', Top_Artist: 'Olivia Rodrigo' },
          { User_ID: 'aidan456', Location: 'Oakland', Minutes: 3600, Top_Genre: 'Afrobeats', Top_Artist: 'Burna Boy' },
          { User_ID: 'colleen789', Location: 'San Jose', Minutes: 3200, Top_Genre: 'Flamenco', Top_Artist: 'ROSALIA' },
          { User_ID: 'mateo999', Location: 'San Jose', Minutes: 800, Top_Genre: 'Afrobeats', Top_Artist: 'Burna Boy' },
        ],
      },
      {
        name: 'Survey_Data',
        columns: ['Name', 'Username', 'Fav_Artist', 'Fav_Song', 'Study'],
        rows: [
          { Name: 'Tiffany', Username: 'tiffany123', Fav_Artist: 'Olivia Rodrigo', Fav_Song: 'Vampire', Study: 'No' },
          { Name: 'Aidan', Username: 'aidan456', Fav_Artist: 'Burna Boy', Fav_Song: 'Last Last', Study: 'No' },
          { Name: 'Colleen', Username: 'colleen789', Fav_Artist: 'ROSALIA', Fav_Song: 'Despacha', Study: 'Yes' },
          { Name: 'Mateo', Username: 'mateo999', Fav_Artist: 'Burna Boy', Fav_Song: 'Last Last', Study: 'No' },
        ],
      },
    ]

    const steps = executeQuery(
      parseQuery("SELECT u.Top_Genre FROM User_Data AS u JOIN Survey_Data AS s ON u.User_ID = s.Username WHERE s.Study = 'No' GROUP BY u.Top_Genre ORDER BY COUNT(*) DESC LIMIT 1"),
      musicTables,
    )
    const rows = steps.at(-1)!.after

    expect(steps.map((step) => step.kind)).toContain('orderBy')
    expect(rows).toHaveLength(1)
    expect(rows[0].values['u.Top_Genre']).toBe('Afrobeats')
  })

  it('adds sort keys and rank movement to order by steps', () => {
    const steps = executeQuery(parseQuery('SELECT u.name, u.tier FROM users AS u ORDER BY u.name DESC'), initialTables)
    const orderStep = steps.find((step) => step.kind === 'orderBy')

    expect(orderStep?.sortSummaries).toEqual([
      { rowId: 'result-4', beforeRank: 4, afterRank: 1, keys: [{ label: 'u.name', value: 'Dina', direction: 'DESC' }] },
      { rowId: 'result-3', beforeRank: 3, afterRank: 2, keys: [{ label: 'u.name', value: 'Chen', direction: 'DESC' }] },
      { rowId: 'result-2', beforeRank: 2, afterRank: 3, keys: [{ label: 'u.name', value: 'Ben', direction: 'DESC' }] },
      { rowId: 'result-1', beforeRank: 1, afterRank: 4, keys: [{ label: 'u.name', value: 'Ada', direction: 'DESC' }] },
    ])
  })

  it('projects aggregate arithmetic and orders by its alias', () => {
    const userData: Table[] = [
      {
        name: 'User_Data',
        columns: ['User_ID', 'Location', 'Minutes', 'Top_Genre', 'Top_Artist'],
        rows: [
          { User_ID: 'tiffany123', Location: 'Berkeley', Minutes: 2400, Top_Genre: 'Pop', Top_Artist: 'Olivia Rodrigo' },
          { User_ID: 'aidan456', Location: 'Oakland', Minutes: 3600, Top_Genre: 'Afrobeats', Top_Artist: 'Burna Boy' },
          { User_ID: 'colleen789', Location: 'Berkeley', Minutes: 1200, Top_Genre: 'Flamenco', Top_Artist: 'ROSALIA' },
        ],
      },
    ]

    const steps = executeQuery(
      parseQuery('SELECT Location, AVG(Minutes) / 60.0 AS Avg_Hours FROM User_Data GROUP BY Location ORDER BY Avg_Hours DESC'),
      userData,
    )
    const rows = steps.at(-1)!.after

    expect(rows.map((row) => row.values.Location)).toEqual(['Oakland', 'Berkeley'])
    expect(rows.map((row) => row.values.Avg_Hours)).toEqual([60, 30])
  })

  it('treats arithmetic around aggregates as an aggregate query', () => {
    const userData: Table[] = [
      {
        name: 'User_Data',
        columns: ['Minutes'],
        rows: [{ Minutes: 120 }, { Minutes: 240 }],
      },
    ]

    const steps = executeQuery(parseQuery('SELECT AVG(Minutes) / 60 AS Avg_Hours FROM User_Data'), userData)
    const rows = steps.at(-1)!.after

    expect(steps.map((step) => step.kind)).toContain('groupBy')
    expect(rows).toHaveLength(1)
    expect(rows[0].values.Avg_Hours).toBe(3)
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
