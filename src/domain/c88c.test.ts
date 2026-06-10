import { describe, expect, it } from 'vitest'
import { executeQuery } from './engine'
import { parseQuery, QueryParseError } from './parser'
import type { Table } from './types'

// Canonical Berkeley C88C / CS61A SQL teaching dataset (dogs of US presidents).
const dogsTables: Table[] = [
  {
    name: 'dogs',
    columns: ['name', 'fur', 'height'],
    rows: [
      { name: 'abraham', fur: 'long', height: 26 },
      { name: 'barack', fur: 'short', height: 52 },
      { name: 'clinton', fur: 'long', height: 47 },
      { name: 'delano', fur: 'long', height: 46 },
      { name: 'eisenhower', fur: 'short', height: 35 },
      { name: 'fillmore', fur: 'curly', height: 32 },
      { name: 'grover', fur: 'short', height: 28 },
      { name: 'herbert', fur: 'curly', height: 31 },
    ],
  },
  {
    name: 'parents',
    columns: ['parent', 'child'],
    rows: [
      { parent: 'abraham', child: 'barack' },
      { parent: 'abraham', child: 'clinton' },
      { parent: 'delano', child: 'herbert' },
      { parent: 'fillmore', child: 'abraham' },
      { parent: 'fillmore', child: 'delano' },
      { parent: 'fillmore', child: 'grover' },
      { parent: 'eisenhower', child: 'fillmore' },
    ],
  },
  {
    name: 'sizes',
    columns: ['size', 'min', 'max'],
    rows: [
      { size: 'toy', min: 0, max: 24 },
      { size: 'mini', min: 25, max: 28 },
      { size: 'medium', min: 29, max: 35 },
      { size: 'standard', min: 36, max: 45 },
    ],
  },
]

function rowsFor(sql: string) {
  const steps = executeQuery(parseQuery(sql), dogsTables)
  return steps.at(-1)!.after
}

describe('C88C: basic selects and filtering', () => {
  it('selects every column with a wildcard', () => {
    const rows = rowsFor('SELECT * FROM dogs')
    expect(rows).toHaveLength(8)
    expect(rows[0].values).toEqual({ name: 'abraham', fur: 'long', height: 26 })
  })

  it('filters rows with a string equality condition', () => {
    const rows = rowsFor("SELECT name FROM dogs WHERE fur = 'curly'")
    expect(rows.map((row) => row.values.name)).toEqual(['fillmore', 'herbert'])
  })

  it('filters rows with a numeric comparison', () => {
    const rows = rowsFor('SELECT name, height FROM dogs WHERE height > 40')
    expect(rows.map((row) => row.values.name)).toEqual(['barack', 'clinton', 'delano'])
  })

  it('orders by a column descending and limits the result', () => {
    const rows = rowsFor('SELECT name FROM dogs ORDER BY height DESC LIMIT 3')
    expect(rows.map((row) => row.values.name)).toEqual(['barack', 'clinton', 'delano'])
  })

  it('evaluates per-row arithmetic in SELECT', () => {
    const rows = rowsFor('SELECT name, height + 10 AS taller FROM dogs LIMIT 2')
    expect(rows.map((row) => row.values.taller)).toEqual([36, 62])
  })
})

describe('C88C: joins', () => {
  it('lists parents of dogs ordered by child height (classic lab query)', () => {
    const rows = rowsFor('SELECT parent FROM parents, dogs WHERE child = name ORDER BY height DESC')
    expect(rows.map((row) => row.values.parent)).toEqual([
      'abraham',
      'abraham',
      'fillmore',
      'eisenhower',
      'delano',
      'fillmore',
      'fillmore',
    ])
  })

  it('finds sibling pairs with a comma self join (classic lab query)', () => {
    const rows = rowsFor(
      'SELECT a.child AS first, b.child AS second FROM parents AS a, parents AS b WHERE a.child < b.child AND a.parent = b.parent',
    )
    expect(rows.map((row) => [row.values.first, row.values.second])).toEqual([
      ['barack', 'clinton'],
      ['abraham', 'delano'],
      ['abraham', 'grover'],
      ['delano', 'grover'],
    ])
  })

  it('matches dogs to size categories with inequality join conditions', () => {
    const rows = rowsFor('SELECT name, size FROM dogs, sizes WHERE height > min AND height <= max')
    expect(rows.map((row) => [row.values.name, row.values.size])).toEqual([
      ['abraham', 'mini'],
      ['eisenhower', 'medium'],
      ['fillmore', 'medium'],
      ['grover', 'mini'],
      ['herbert', 'medium'],
    ])
  })

  it('finds grandparent pairs with a comma self join', () => {
    const rows = rowsFor(
      'SELECT a.parent AS grandog, b.child AS pup FROM parents AS a, parents AS b WHERE a.child = b.parent',
    )
    expect(rows.map((row) => [row.values.grandog, row.values.pup])).toEqual([
      ['fillmore', 'barack'],
      ['fillmore', 'clinton'],
      ['fillmore', 'herbert'],
      ['eisenhower', 'abraham'],
      ['eisenhower', 'delano'],
      ['eisenhower', 'grover'],
    ])
  })

  it('supports explicit JOIN ... ON syntax', () => {
    const rows = rowsFor(
      'SELECT d.name, p.parent FROM dogs AS d JOIN parents AS p ON d.name = p.child WHERE d.height > 40',
    )
    expect(rows.map((row) => [row.values['d.name'], row.values['p.parent']])).toEqual([
      ['barack', 'abraham'],
      ['clinton', 'abraham'],
      ['delano', 'fillmore'],
    ])
  })
})

describe('C88C: aggregation', () => {
  it('computes MAX over a table', () => {
    const rows = rowsFor('SELECT MAX(height) FROM dogs')
    expect(rows).toHaveLength(1)
    expect(rows[0].values['MAX(height)']).toBe(52)
  })

  it('computes COUNT(*) after filtering', () => {
    const rows = rowsFor("SELECT COUNT(*) FROM dogs WHERE fur = 'short'")
    expect(rows[0].values['COUNT(*)']).toBe(3)
  })

  it('computes arithmetic between aggregates', () => {
    const rows = rowsFor('SELECT MAX(height) - MIN(height) AS spread FROM dogs')
    expect(rows[0].values.spread).toBe(26)
  })

  it('groups by fur and aggregates per group', () => {
    const rows = rowsFor('SELECT fur, MAX(height) FROM dogs GROUP BY fur')
    expect(rows.map((row) => [row.values.fur, row.values['MAX(height)']])).toEqual([
      ['long', 47],
      ['short', 52],
      ['curly', 32],
    ])
  })

  it('filters groups with HAVING COUNT(*)', () => {
    const rows = rowsFor('SELECT fur FROM dogs GROUP BY fur HAVING COUNT(*) > 2')
    expect(rows.map((row) => row.values.fur)).toEqual(['long', 'short'])
  })

  it('orders grouped rows by an aggregate alias', () => {
    const rows = rowsFor('SELECT fur, COUNT(*) AS n FROM dogs GROUP BY fur ORDER BY n DESC')
    expect(rows.map((row) => [row.values.fur, row.values.n])).toEqual([
      ['long', 3],
      ['short', 3],
      ['curly', 2],
    ])
  })

  it('computes AVG per group with arithmetic', () => {
    const rows = rowsFor('SELECT fur, AVG(height) AS avg_height FROM dogs GROUP BY fur HAVING AVG(height) > 35')
    expect(rows.map((row) => [row.values.fur, row.values.avg_height])).toEqual([
      ['long', (26 + 47 + 46) / 3 ],
      ['short', (52 + 35 + 28) / 3 ],
    ])
  })
})

describe('C88C: unsupported course patterns fail loudly, not silently', () => {
  it('rejects SELECT without FROM (literal selects)', () => {
    expect(() => parseQuery("SELECT 'hello', 38")).toThrow(QueryParseError)
  })

  it('rejects DISTINCT', () => {
    expect(() => parseQuery('SELECT DISTINCT fur FROM dogs')).toThrow(QueryParseError)
  })

  it('rejects OR conditions', () => {
    expect(() => parseQuery("SELECT name FROM dogs WHERE fur = 'curly' OR fur = 'short'")).toThrow(
      /OR is not supported/,
    )
  })

  it('still allows the word or inside a quoted string value', () => {
    const ast = parseQuery("SELECT name FROM dogs WHERE fur = 'curly or short'")
    expect(ast.where[0].right).toEqual({ type: 'literal', value: 'curly or short', label: "'curly or short'" })
  })

  it('rejects subqueries', () => {
    expect(() =>
      parseQuery('SELECT name FROM dogs WHERE height > (SELECT AVG(height) FROM dogs)'),
    ).toThrow(QueryParseError)
  })

  it('rejects outer joins', () => {
    expect(() =>
      parseQuery('SELECT d.name FROM dogs AS d LEFT JOIN parents AS p ON d.name = p.child'),
    ).toThrow(QueryParseError)
  })
})
