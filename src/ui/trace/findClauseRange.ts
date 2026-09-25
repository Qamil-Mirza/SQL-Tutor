// The engine keeps the student's clause text on one line; the formatter wraps and
// indents it. Match tolerant of whitespace and case so the highlight tracks the
// formatted SQL as displayed.
export function findClauseRange(sql: string, clause: string): [number, number] | undefined {
  const pattern = clause
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const match = new RegExp(pattern, 'i').exec(sql)
  if (!match) return undefined
  return [match.index, match.index + match[0].length]
}
