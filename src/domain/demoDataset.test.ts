import { describe, expect, it } from 'vitest'
import { executeQuery } from './engine'
import { parseQuery } from './parser'
import { parseTableSql } from './tableSql'

// The live demo: one query that exercises every kind of step and highlight the visualizer draws.
const demoTableSql = `CREATE TABLE students (id, name, major, year);
INSERT INTO students VALUES
  (1, 'Ada', 'CS', 3),
  (2, 'Ben', 'Math', 2),
  (3, 'Chen', 'CS', 4),
  (4, 'Dina', 'Data', 3),
  (5, 'Eli', 'Math', 1),
  (6, 'Fay', 'Data', 2),
  (7, 'Gus', 'Stats', 4),
  (8, 'Hana', 'CS', 2),
  (10, 'Ivy', 'Stats', 3);

CREATE TABLE enrollments (student_id, course, grade, units);
INSERT INTO enrollments VALUES
  (1, 'C88C', 92, 4),
  (1, 'C100', 85, 4),
  (2, 'C88C', 78, 4),
  (2, 'STAT20', 88, 4),
  (3, 'C88C', 95, 4),
  (3, 'C100', NULL, 4),
  (4, 'C8', 93, 4),
  (4, 'C88C', 96, 4),
  (5, 'C88C', 99, 4),
  (6, 'C8', 74, 4),
  (6, 'C100', 83, 4),
  (8, 'C88C', 70, 2),
  (9, 'C8', 60, 4),
  (10, 'STAT20', 88, 4);`

const demoQuery = `SELECT s.major, COUNT(*) AS enrolled, AVG(e.grade) AS avg_grade,
       MAX(e.grade) AS best, SUM(e.units) * 2 AS weighted_units
FROM students AS s
JOIN enrollments AS e ON s.id = e.student_id
WHERE e.grade IS NOT NULL AND s.year >= 2
GROUP BY s.major
HAVING COUNT(*) >= 2
ORDER BY avg_grade DESC
LIMIT 2`

function demoSteps() {
  return executeQuery(parseQuery(demoQuery), parseTableSql(demoTableSql))
}

describe('demo dataset', () => {
  it('walks through every step kind in logical order', () => {
    expect(demoSteps().map((step) => step.kind)).toEqual([
      'from', 'join', 'where', 'where', 'groupBy', 'having', 'selectGroup', 'selectGroup', 'selectGroup', 'orderBy', 'limit',
    ])
  })

  it('shows unmatched join rows, rows removed by each WHERE condition, and a rejected group', () => {
    const [, join, whereNull, whereYear, , having] = demoSteps()
    expect(join.highlights).toContainEqual({ kind: 'unmatched', rowIds: ['s7', 'e13'] })
    expect(whereNull.highlights).toContainEqual({ kind: 'removed', rowIds: ['s3+e6'] })
    expect(whereYear.highlights).toContainEqual({ kind: 'removed', rowIds: ['s5+e9'] })
    expect(having.summary).toBe('Kept 3 of 4 groups where COUNT(*) >= 2.')
  })

  it('reorders groups with ORDER BY and trims one with LIMIT', () => {
    const steps = demoSteps()
    const orderBy = steps[steps.length - 2]
    const limit = steps[steps.length - 1]
    expect(orderBy.sortSummaries?.some((entry) => entry.beforeRank !== entry.afterRank)).toBe(true)
    expect(limit.highlights).toContainEqual({ kind: 'removed', rowIds: ['#2'] })
    expect(limit.after).toEqual([
      expect.objectContaining({ values: { major: 'Data', enrolled: 4, avg_grade: 86.5, best: 96, weighted_units: 32 } }),
      expect.objectContaining({ values: { major: 'CS', enrolled: 4, avg_grade: 85.5, best: 95, weighted_units: 28 } }),
    ])
  })
})
