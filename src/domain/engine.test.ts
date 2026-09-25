import { describe, expect, it } from 'vitest'
import { executeQuery } from './engine'
import { parseQuery } from './parser'
import { initialTables } from './samples'
import type { AliasedRow, Group, Table } from './types'

function rowsFor(sql: string) {
  const steps = executeQuery(parseQuery(sql), initialTables)
  // The final step is always row-producing (select/selectGroup/orderBy/limit), never raw groups.
  return steps.at(-1)!.after as AliasedRow[]
}

describe('executeQuery', () => {
  it('aliases and filters rows', () => {
    const rows = rowsFor("SELECT u.name FROM users AS u WHERE u.tier = 'pro'")
    expect(rows).toHaveLength(2)
    expect(rows[0].values.name).toBe('Ada')
  })

  it('joins rows', () => {
    const rows = rowsFor('SELECT u.name, l.artist FROM users AS u JOIN listening AS l ON u.id = l.user_id WHERE l.minutes > 40')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.values.name)).toEqual(['Ada', 'Chen'])
  })

  it('uses compact alias row ids for source and joined rows', () => {
    const steps = executeQuery(parseQuery('SELECT u.name, l.artist FROM users AS u JOIN listening AS l ON u.id = l.user_id'), initialTables)
    const fromStep = steps.find((step) => step.kind === 'from')!
    const joinStep = steps.find((step) => step.kind === 'join')!

    expect((fromStep.after as AliasedRow[]).map((row) => row.id)).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect((joinStep.after as AliasedRow[]).map((row) => row.id)).toEqual(['u1+l1', 'u1+l2', 'u2+l3', 'u3+l4', 'u4+l5'])
  })

  it('supports explicit JOIN ... ON conditions joined with AND', () => {
    const tables: Table[] = [
      {
        name: 'staff',
        columns: ['name', 'location', 'single', 'budget', 'in_state'],
        rows: [
          { name: 'Alicia', location: 'Downtown', single: true, budget: 1100, in_state: false },
          { name: 'Dhruv', location: 'Downtown', single: false, budget: 2000, in_state: false },
          { name: 'Grace X', location: 'Downtown', single: false, budget: 1900, in_state: false },
        ],
      },
      {
        name: 'apartments',
        columns: ['name', 'rent', 'location', 'single'],
        rows: [
          { name: 'Dwight', rent: 2000, location: 'Downtown', single: false },
          { name: 'Identity', rent: 900, location: 'Downtown', single: true },
          { name: 'Blake', rent: 1200, location: 'Downtown', single: true },
        ],
      },
    ]

    const rows = executeQuery(
      parseQuery(
        'SELECT s.name AS staff_name, a.name AS apartment_name, s.budget - a.rent AS budget_surplus FROM staff AS s JOIN apartments AS a ON s.location = a.location AND s.single = a.single WHERE s.budget - a.rent >= 0 ORDER BY staff_name ASC, budget_surplus DESC',
      ),
      tables,
    ).at(-1)!.after as AliasedRow[]

    expect(rows.map((row) => row.values)).toEqual([
      { staff_name: 'Alicia', apartment_name: 'Identity', budget_surplus: 200 },
      { staff_name: 'Dhruv', apartment_name: 'Dwight', budget_surplus: 0 },
    ])
  })

  it('highlights the join key columns', () => {
    const steps = executeQuery(parseQuery('SELECT u.name, l.artist FROM users AS u JOIN listening AS l ON u.id = l.user_id'), initialTables)
    const joinStep = steps.find((step) => step.kind === 'join')

    expect(joinStep?.highlights).toContainEqual({
      kind: 'selected',
      columnKeys: ['u.id', 'l.user_id'],
    })
  })

  it('exposes the computed value tested by each HAVING condition', () => {
    const steps = executeQuery(
      parseQuery('SELECT u.tier, SUM(l.minutes) FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80'),
      initialTables,
    )
    const havingStep = steps.find((step) => step.kind === 'having')!
    const groups = havingStep.before as Group[]

    const pro = groups.find((group) => group.key.includes('pro'))!
    const free = groups.find((group) => group.key.includes('free'))!
    expect(pro.conditions).toContainEqual({ label: 'SUM(l.minutes) > 80', result: true, value: 165, leftLabel: 'SUM(l.minutes)' })
    expect(free.conditions).toContainEqual({ label: 'SUM(l.minutes) > 80', result: false, value: 45, leftLabel: 'SUM(l.minutes)' })
  })

  it('does not paint every joined row as matched (only the joined-in columns are highlighted)', () => {
    const steps = executeQuery(parseQuery('SELECT u.name, l.artist FROM users AS u JOIN listening AS l ON u.id = l.user_id'), initialTables)
    const joinStep = steps.find((step) => step.kind === 'join')

    expect(joinStep?.highlights.some((highlight) => highlight.kind === 'matched')).toBe(false)
  })

  it('highlights the source columns referenced by the SELECT list', () => {
    const tables: Table[] = [
      {
        name: 'staff',
        columns: ['name', 'location', 'single', 'budget', 'in_state'],
        rows: [{ name: 'Alicia', location: 'Downtown', single: true, budget: 1100, in_state: false }],
      },
      {
        name: 'apartments',
        columns: ['name', 'rent', 'location', 'single'],
        rows: [{ name: 'Identity', rent: 900, location: 'Downtown', single: true }],
      },
    ]

    const steps = executeQuery(
      parseQuery(
        'SELECT s.name AS staff_name, s.in_state AS in_state, a.name AS apartment_name, s.budget - a.rent AS budget_surplus FROM staff AS s JOIN apartments AS a ON s.location = a.location AND s.single = a.single',
      ),
      tables,
    )
    const selectStep = steps.find((step) => step.kind === 'select')!

    expect(selectStep.highlights).toContainEqual({
      kind: 'selected',
      columnKeys: ['s.name', 's.in_state', 'a.name', 's.budget', 'a.rent'],
    })
  })

  it('supports self joins', () => {
    const rows = rowsFor('SELECT e.name AS employee, m.name AS manager FROM employees AS e JOIN employees AS m ON e.manager_id = m.id')
    expect(rows).toHaveLength(3)
    expect(rows[0].values.manager).toBe('Priya')
  })

  it('supports self joins with aliases that omit AS', () => {
    const rows = rowsFor('SELECT employee.name, manager.name FROM employees employee JOIN employees manager ON employee.manager_id = manager.id')
    expect(rows).toHaveLength(3)
    expect(rows[0].values['employee.name']).toBe('Mateo')
    expect(rows[0].values['manager.name']).toBe('Priya')
  })

  it('groups, filters groups with having, and projects aggregates', () => {
    const rows = rowsFor(
      'SELECT u.tier, COUNT(*) AS plays, SUM(l.minutes) AS minutes FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].values.plays).toBe(3)
    expect(rows[0].values.minutes).toBe(165)
  })

  it('labels groups with their grouping expression using the bare column name', () => {
    const steps = executeQuery(
      parseQuery('SELECT u.tier, COUNT(*) AS plays, SUM(l.minutes) AS minutes FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80'),
      initialTables,
    )
    const groupStep = steps.find((step) => step.kind === 'groupBy')!
    const proGroup = (groupStep.after as Group[]).find((group) => group.key === 'tier = pro')

    expect(proGroup).toBeDefined()
    expect(proGroup?.rows).toHaveLength(3)
  })

  it('adds having condition evaluations to groups', () => {
    const steps = executeQuery(
      parseQuery('SELECT u.tier, COUNT(*) AS plays, SUM(l.minutes) AS minutes FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80'),
      initialTables,
    )
    const havingStep = steps.find((step) => step.kind === 'having')!
    const removedGroup = havingStep.before?.find((group) => 'rows' in group && group.key === 'tier = free') as Group | undefined

    expect(removedGroup?.conditions).toEqual([
      { label: 'SUM(l.minutes) > 80', result: false, value: 45, leftLabel: 'SUM(l.minutes)' },
    ])
  })

  it('computes MIN and MAX over strings lexicographically', () => {
    const tables: Table[] = [
      {
        name: 'pets',
        columns: ['name'],
        rows: [{ name: 'Miso' }, { name: 'Nori' }, { name: 'Ada' }],
      },
    ]

    const rows = executeQuery(parseQuery('SELECT MIN(name), MAX(name) FROM pets'), tables).at(-1)!.after as AliasedRow[]

    expect(rows[0].values['MIN(name)']).toBe('Ada')
    expect(rows[0].values['MAX(name)']).toBe('Nori')
  })

  it('applies limit after projection', () => {
    const rows = rowsFor('SELECT u.name FROM users AS u LIMIT 2')
    expect(rows.map((row) => row.values.name)).toEqual(['Ada', 'Ben'])
  })

  it('drops trimmed rows from the limit step after view and marks them removed in before', () => {
    const steps = executeQuery(parseQuery('SELECT u.name FROM users AS u LIMIT 2'), initialTables)
    const limitStep = steps.find((step) => step.kind === 'limit')!
    const before = limitStep.before as AliasedRow[]
    const after = limitStep.after as AliasedRow[]

    expect(before).toHaveLength(4)
    expect(after).toHaveLength(2)
    expect(after.some((row) => row.id.includes('__removed'))).toBe(false)
    expect(limitStep.highlights).toContainEqual({
      kind: 'removed',
      rowIds: before.slice(2).map((row) => row.id),
    })
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
    const rows = steps.at(-1)!.after as AliasedRow[]

    expect(steps.map((step) => step.kind)).toContain('orderBy')
    expect(rows).toHaveLength(1)
    expect(rows[0].values.Top_Genre).toBe('Afrobeats')
  })

  it('executes comma joins that use table names as implicit aliases', () => {
    const petTables: Table[] = [
      {
        name: 'friends',
        columns: ['name', 'animal'],
        rows: [
          { name: 'Ada', animal: 'cat' },
          { name: 'Ben', animal: 'dog' },
          { name: 'Chen', animal: 'dog' },
        ],
      },
      {
        name: 'animals',
        columns: ['animal', 'sound'],
        rows: [
          { animal: 'cat', sound: 'meow' },
          { animal: 'dog', sound: 'woof' },
        ],
      },
    ]

    const rows = executeQuery(
      parseQuery('SELECT animals.sound, COUNT(*) FROM friends, animals WHERE friends.animal = animals.animal GROUP BY animals.sound ORDER BY COUNT(*) ASC'),
      petTables,
    ).at(-1)!.after as AliasedRow[]

    expect(rows.map((row) => row.values)).toEqual([
      { sound: 'meow', 'COUNT(*)': 1 },
      { sound: 'woof', 'COUNT(*)': 2 },
    ])
  })

  it('adds sort keys and rank movement to order by steps', () => {
    const steps = executeQuery(parseQuery('SELECT u.name, u.tier FROM users AS u ORDER BY u.name DESC'), initialTables)
    const orderStep = steps.find((step) => step.kind === 'orderBy')

    expect(orderStep?.sortSummaries).toEqual([
      { rowId: '#4', beforeRank: 4, afterRank: 1, keys: [{ label: 'u.name', value: 'Dina', direction: 'DESC' }] },
      { rowId: '#3', beforeRank: 3, afterRank: 2, keys: [{ label: 'u.name', value: 'Chen', direction: 'DESC' }] },
      { rowId: '#2', beforeRank: 2, afterRank: 3, keys: [{ label: 'u.name', value: 'Ben', direction: 'DESC' }] },
      { rowId: '#1', beforeRank: 1, afterRank: 4, keys: [{ label: 'u.name', value: 'Ada', direction: 'DESC' }] },
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
    const rows = steps.at(-1)!.after as AliasedRow[]

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
    const rows = steps.at(-1)!.after as AliasedRow[]

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
    const rows = steps.at(-1)!.after as AliasedRow[]

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
    const rows = steps.at(-1)!.after as AliasedRow[]

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
    const rows = steps.at(-1)!.after as AliasedRow[]

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
    const rows = steps.at(-1)!.after as AliasedRow[]

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

    expect(steps[0].summary).toBe('Start with all 2 rows of mentors (as m1) and all 2 rows of mentors (as m2).')
    expect(steps[1].summary).toBe('Paired every row of m1 with every row of m2: 2 × 2 = 4 pairs.')
  })

  it('exposes both source tables for comma join visualization', () => {
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

    const [fromStep] = executeQuery(parseQuery('SELECT m1.name, m2.name FROM mentors AS m1, mentors as m2 WHERE m1.name > m2.name'), mentors)

    expect(fromStep.sources?.map((source) => source.label)).toEqual(['mentors (as m1)', 'mentors (as m2)'])
    expect(fromStep.sources?.map((source) => source.rows.map((row) => row.id))).toEqual([
      ['m11', 'm12'],
      ['m21', 'm22'],
    ])
  })

  it('exposes both source tables before explicit JOIN pairing', () => {
    const steps = executeQuery(parseQuery('SELECT u.name, l.artist FROM users AS u JOIN listening AS l ON u.id = l.user_id'), initialTables)
    const joinStep = steps.find((step) => step.kind === 'join')!

    expect(joinStep.sources?.map((source) => source.label)).toEqual(['users (as u)', 'listening (as l)'])
    expect(joinStep.sources?.map((source) => source.rows.map((row) => row.id))).toEqual([
      ['u1', 'u2', 'u3', 'u4'],
      ['l1', 'l2', 'l3', 'l4', 'l5'],
    ])
  })

  it('adds the active SQL clause to trace steps', () => {
    const steps = executeQuery(
      parseQuery("SELECT u.name, u.tier FROM users AS u WHERE u.tier = 'pro' LIMIT 2"),
      initialTables,
    )

    expect(steps.map((step) => step.clause)).toEqual([
      'FROM users AS u',
      "WHERE u.tier = 'pro'",
      'SELECT u.name, u.tier',
      'LIMIT 2',
    ])
  })

  it('labels comma join pairing as a cross join without per-pair details', () => {
    const petTables: Table[] = [
      {
        name: 'friends',
        columns: ['name', 'animal'],
        rows: [
          { name: 'Ada', animal: 'cat' },
          { name: 'Ben', animal: 'dog' },
        ],
      },
      {
        name: 'animals',
        columns: ['animal', 'sound'],
        rows: [
          { animal: 'cat', sound: 'meow' },
          { animal: 'dog', sound: 'woof' },
        ],
      },
    ]

    const steps = executeQuery(
      parseQuery('SELECT animals.sound, COUNT(*) FROM friends, animals WHERE friends.animal = animals.animal GROUP BY animals.sound ORDER BY COUNT(*) ASC'),
      petTables,
    )
    const pairStep = steps[1]

    expect(pairStep.title).toBe('Cross join')
    expect(pairStep.clause).toBe('FROM friends, animals')
    expect(pairStep.details).toBeUndefined()
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
    expect(whereSteps.map((step) => step.clause)).toEqual(['m1.name > m2.name', 'm1.language = m2.language'])
    expect(whereSteps[0].before).toHaveLength(16)
    expect(whereSteps[0].after).toHaveLength(6)
    expect(whereSteps[1].before).toHaveLength(6)
    expect(whereSteps[1].after).toHaveLength(2)
    const afterRows = whereSteps.flatMap((step) => step.after as AliasedRow[])
    expect(afterRows.some((row) => row.id.includes('__removed'))).toBe(false)
    expect(steps.at(-1)!.after).toHaveLength(2)
  })

  const emptyish: Table[] = [
    { name: 'dogs', columns: ['name', 'fur', 'height'], rows: [
      { name: 'abraham', fur: 'long', height: 26 },
      { name: 'barack', fur: 'short', height: 52 },
      { name: 'clinton', fur: 'long', height: 47 },
    ] },
  ]

  it('returns one row of aggregates over zero rows', () => {
    const steps = executeQuery(parseQuery("SELECT COUNT(*), SUM(height), AVG(height), MIN(height) FROM dogs WHERE fur = 'none'"), emptyish)
    const rows = steps.at(-1)!.after as AliasedRow[]
    expect(rows).toHaveLength(1)
    expect(rows[0].values).toEqual({ 'COUNT(*)': 0, 'SUM(height)': null, 'AVG(height)': null, 'MIN(height)': null })
  })

  it('returns zero groups when GROUP BY runs over zero rows', () => {
    const steps = executeQuery(parseQuery("SELECT fur, COUNT(*) FROM dogs WHERE fur = 'none' GROUP BY fur"), emptyish)
    expect(steps.at(-1)!.after).toEqual([])
    expect(steps.at(-1)!.kind).toBe('select')
  })

  it('COUNT(column) ignores NULL while COUNT(*) counts rows', () => {
    const rows = rowsFor('SELECT COUNT(manager_id) AS managed, COUNT(*) AS total FROM employees') as AliasedRow[]
    expect(rows[0].values).toEqual({ managed: 3, total: 4 })
  })

  it('treats comparisons with NULL as false and supports IS NULL', () => {
    expect((rowsFor('SELECT name FROM employees WHERE manager_id = NULL') as AliasedRow[])).toHaveLength(0)
    expect((rowsFor('SELECT name FROM employees WHERE manager_id != 1') as AliasedRow[]).map((row) => row.values.name)).toEqual(['Noor'])
    expect((rowsFor('SELECT name FROM employees WHERE manager_id IS NULL') as AliasedRow[]).map((row) => row.values.name)).toEqual(['Priya'])
    expect((rowsFor('SELECT name FROM employees WHERE manager_id IS NOT NULL') as AliasedRow[])).toHaveLength(3)
  })

  it('takes bare columns from the MAX or MIN row like SQLite', () => {
    expect((rowsFor('SELECT name, MAX(salary) FROM employees') as AliasedRow[])[0].values).toEqual({ name: 'Priya', 'MAX(salary)': 150000 })
    expect((rowsFor('SELECT name, MIN(salary) FROM employees') as AliasedRow[])[0].values).toEqual({ name: 'Noor', 'MIN(salary)': 91000 })
    expect((rowsFor('SELECT department, name, MAX(salary) FROM employees GROUP BY department') as AliasedRow[]).map((row) => row.values.name)).toEqual(['Priya', 'Iris'])
  })

  it('sorts by ORDER BY position', () => {
    const rows = rowsFor('SELECT name, salary FROM employees ORDER BY 2 DESC') as AliasedRow[]
    expect(rows.map((row) => row.values.name)).toEqual(['Priya', 'Iris', 'Mateo', 'Noor'])
    const orderStep = executeQuery(parseQuery('SELECT name, salary FROM employees ORDER BY 2 DESC'), initialTables).find((step) => step.kind === 'orderBy')!
    expect(orderStep.sortSummaries![0].keys[0].label).toBe('salary')
    expect(() => rowsFor('SELECT name FROM employees ORDER BY 3')).toThrow('ORDER BY 3 is out of range: the result has 1 column(s).')
  })

  it('compares numbers and numeric strings consistently for every operator', () => {
    const tables: Table[] = [{ name: 't', columns: ['a'], rows: [{ a: '10' }, { a: 9 }, { a: 'abc' }] }]
    const rows = (sql: string) => (executeQuery(parseQuery(sql), tables).at(-1)!.after as AliasedRow[]).map((row) => row.values.a)
    expect(rows("SELECT a FROM t WHERE a = '9'")).toEqual([9])
    // Like SQLite, text sorts after every number, so 'abc' >= 10 is true.
    expect(rows('SELECT a FROM t WHERE a >= 10')).toEqual(['10', 'abc'])
    expect(rows('SELECT a FROM t ORDER BY a')).toEqual([9, '10', 'abc'])
  })

  it('matches column and table names case-insensitively', () => {
    const rows = rowsFor('SELECT NAME FROM EMPLOYEES WHERE Department = "ops"') as AliasedRow[]
    expect(rows.map((row) => row.values.NAME)).toEqual(['Priya', 'Mateo'])
  })

  it('resolves SELECT aliases in GROUP BY, HAVING and ORDER BY', () => {
    const rows = rowsFor('SELECT department AS dept, COUNT(*) AS n FROM employees GROUP BY dept HAVING n > 1 ORDER BY n DESC, dept') as AliasedRow[]
    // Both departments have 2 people, so the tie on n falls through to dept ascending.
    expect(rows.map((row) => row.values)).toEqual([{ dept: 'data', n: 2 }, { dept: 'ops', n: 2 }])
  })

  it('keeps result columns in the order written', () => {
    const rows = rowsFor("SELECT name, 1 AS one, 'x' FROM employees LIMIT 1") as AliasedRow[]
    expect(rows[0].columns).toEqual(['name', 'one', "'x'"])
  })

  it('uses bare headers for single-source queries and qualified keys only with two sources', () => {
    const single = executeQuery(parseQuery('SELECT u.name FROM users AS u'), initialTables)
    expect(Object.keys((single[0].after as AliasedRow[])[0].values)).toEqual(['id', 'name', 'tier', 'region'])
    expect((single.at(-1)!.after as AliasedRow[])[0].values).toEqual({ name: 'Ada' })

    const joined = executeQuery(parseQuery('SELECT u.name, l.artist FROM users AS u JOIN listening AS l ON u.id = l.user_id'), initialTables)
    expect(Object.keys((joined[0].after as AliasedRow[])[0].values)).toEqual(['u.id', 'u.name', 'u.tier', 'u.region'])
    expect((joined.at(-1)!.after as AliasedRow[])[0].values).toEqual({ name: 'Ada', artist: 'Nina Simone' })
  })

  it('keeps qualified headers when two selected columns would collide', () => {
    const rows = rowsFor('SELECT a.name, b.name FROM employees AS a JOIN employees AS b ON a.manager_id = b.id') as AliasedRow[]
    expect(rows[0].columns).toEqual(['a.name', 'b.name'])
  })

  it('numbers projected rows and keeps the numbers through ORDER BY and LIMIT', () => {
    const steps = executeQuery(parseQuery('SELECT name FROM employees ORDER BY name DESC LIMIT 2'), initialTables)
    const orderStep = steps.find((step) => step.kind === 'orderBy')!
    expect((orderStep.before as AliasedRow[]).map((row) => row.id)).toEqual(['#1', '#2', '#3', '#4'])
    expect((orderStep.after as AliasedRow[]).map((row) => row.id)).toEqual(['#1', '#4', '#2', '#3'])
    expect(orderStep.sortSummaries?.map((summary) => [summary.rowId, summary.beforeRank, summary.afterRank])).toEqual([
      ['#1', 1, 1], ['#4', 4, 2], ['#2', 2, 3], ['#3', 3, 4],
    ])
    expect((steps.at(-1)!.after as AliasedRow[]).map((row) => row.id)).toEqual(['#1', '#4'])
  })

  it('emits one selectGroup step per group and no result step', () => {
    const steps = executeQuery(parseQuery('SELECT u.region, COUNT(*) AS n FROM users AS u GROUP BY u.region'), initialTables)
    expect(steps.map((step) => step.kind)).toEqual(['from', 'groupBy', 'selectGroup', 'selectGroup'])
    expect(steps[2].summary).toBe('Collapsed group region = west (2 rows) into one result row (1 of 2).')
    expect((steps[2].before as Group[]).map((group) => group.key)).toEqual(['region = west'])
    expect((steps[2].after as AliasedRow[]).map((row) => row.id)).toEqual(['#1'])
    expect((steps[3].after as AliasedRow[]).map((row) => row.id)).toEqual(['#1', '#2'])
    expect(steps[3].highlights).toContainEqual({ kind: 'matched', rowIds: ['#2'] })
  })

  it('writes concrete summaries for each step kind', () => {
    const steps = executeQuery(parseQuery("SELECT u.name FROM users AS u JOIN listening AS l ON u.id = l.user_id WHERE l.minutes > 30 ORDER BY u.name DESC LIMIT 5"), initialTables)
    expect(steps.map((step) => step.summary)).toEqual([
      'Start with all 4 rows of users (as u).',
      'Paired 5 of the 4 × 5 possible combinations where u.id = l.user_id.',
      'Kept 3 of 5 rows where l.minutes > 30.',
      'Kept only the columns you asked for: name.',
      'Sorted 3 rows by u.name (highest first).',
      'Nothing trimmed: 3 rows, limit is 5.',
    ])
    expect(steps[1].details).toEqual(['u1 ↔ l1, l2', 'u2 ↔ l3', 'u3 ↔ l4', 'u4 ↔ l5'])
    expect(steps[1].clause).toBe('JOIN listening AS l ON u.id = l.user_id')
    // After WHERE the rows are Ada (55), Ada (35), Chen (75) → #1, #2, #3.
    // ORDER BY u.name DESC gives Chen, Ada, Ada, and LIMIT 5 keeps all three.
    expect((steps.at(-1)!.after as AliasedRow[]).map((row) => row.id)).toEqual(['#3', '#1', '#2'])
  })

  it('marks unmatched join rows and names them in the summary', () => {
    const tables: Table[] = [
      { name: 'a', columns: ['id'], rows: [{ id: 1 }, { id: 2 }] },
      { name: 'b', columns: ['a_id'], rows: [{ a_id: 1 }, { a_id: 9 }] },
    ]
    const step = executeQuery(parseQuery('SELECT * FROM a AS x JOIN b AS y ON x.id = y.a_id'), tables)[1]
    expect(step.summary).toBe('Paired 1 of the 2 × 2 possible combinations where x.id = y.a_id. x2, y2 had no match.')
    expect(step.highlights).toContainEqual({ kind: 'unmatched', rowIds: ['x2', 'y2'] })
    expect(step.highlights).toContainEqual({ kind: 'selected', columnKeys: ['x.id', 'y.a_id'] })
  })

  it('describes comma joins, implicit groups, HAVING and LIMIT trimming', () => {
    const steps = executeQuery(parseQuery('SELECT COUNT(*) FROM users, listening HAVING COUNT(*) > 1 LIMIT 0'), initialTables)
    expect(steps.map((step) => [step.kind, step.summary])).toEqual([
      ['from', 'Start with all 4 rows of users and all 5 rows of listening.'],
      ['join', 'Paired every row of users with every row of listening: 4 × 5 = 20 pairs.'],
      ['groupBy', 'No GROUP BY, so all 20 rows form one group for the aggregates.'],
      ['having', 'Kept 1 of 1 group where COUNT(*) > 1.'],
      ['selectGroup', 'Collapsed group all rows (20 rows) into one result row (1 of 1).'],
      ['limit', 'Kept the first 0 of 1 row.'],
    ])
    expect(steps[2].clause).toBeUndefined()
  })

  it('rejects aggregates in GROUP BY, directly or through an alias', () => {
    expect(() => rowsFor('SELECT name, COUNT(*) FROM employees GROUP BY COUNT(*)')).toThrow("COUNT(*) can't be used in GROUP BY. Group by a column instead.")
    expect(() => rowsFor('SELECT COUNT(*) AS n FROM employees GROUP BY n')).toThrow("n can't be used in GROUP BY because it is COUNT(*). Group by a column instead.")
  })

  it('orders text by code units like SQLite BINARY collation', () => {
    const tables: Table[] = [{ name: 't', columns: ['a'], rows: [{ a: 'apple' }, { a: 'Banana' }, { a: 'cherry' }] }]
    const rows = executeQuery(parseQuery('SELECT a FROM t ORDER BY a'), tables).at(-1)!.after as AliasedRow[]
    expect(rows.map((row) => row.values.a)).toEqual(['Banana', 'apple', 'cherry'])
  })

  it('keeps NULL and empty-string groups apart and labels the NULL group', () => {
    const tables: Table[] = [{ name: 't', columns: ['b'], rows: [{ b: null }, { b: '' }, { b: 'x' }] }]
    const steps = executeQuery(parseQuery('SELECT b, COUNT(*) AS n FROM t GROUP BY b'), tables)
    const groupStep = steps.find((step) => step.kind === 'groupBy')!
    expect((groupStep.after as Group[]).map((group) => group.key)).toEqual(['b = NULL', 'b = ', 'b = x'])
    expect((steps.at(-1)!.after as AliasedRow[]).map((row) => row.values.n)).toEqual([1, 1, 1])
  })
  it('divides integers like SQLite and returns NULL for division by zero', () => {
    const tables: Table[] = [{ name: 't', columns: ['a', 'b'], rows: [{ a: 26, b: 10 }, { a: 30, b: 0 }] }]
    const values = (sql: string) => (executeQuery(parseQuery(sql), tables).at(-1)!.after as AliasedRow[]).map((row) => Object.values(row.values)[0])
    expect(values('SELECT a / b FROM t')).toEqual([2, null])
    expect(values('SELECT a / 10.0 FROM t')).toEqual([2.6, 3])
    expect(values('SELECT AVG(a) / 2 FROM t')).toEqual([14])
    expect(values('SELECT SUM(a) / COUNT(*) FROM t')).toEqual([28])
    expect((executeQuery(parseQuery('SELECT a FROM t WHERE a / 10 = 3'), tables).at(-1)!.after as AliasedRow[]).map((row) => row.values.a)).toEqual([30])
  })

  it('reports unknown columns even when no rows reach the clause', () => {
    expect(() => rowsFor('SELECT typo FROM employees WHERE salary > 1000000')).toThrow('Unknown column "typo".')
    expect(() => rowsFor('SELECT typo, COUNT(*) FROM employees WHERE salary > 1000000 GROUP BY department')).toThrow('Unknown column "typo".')
    expect(() => rowsFor('SELECT u.nope FROM users AS u JOIN listening AS l ON u.id = l.user_id WHERE l.minutes > 999')).toThrow('Unknown column "u.nope".')
    expect(() => rowsFor('SELECT name FROM employees ORDER BY nope')).toThrow('Unknown column "nope".')
    // Output aliases stay usable in ORDER BY and HAVING.
    expect(rowsFor('SELECT department AS dept, COUNT(*) AS n FROM employees GROUP BY dept HAVING n > 0 ORDER BY n DESC, dept')).toHaveLength(2)
  })
})
