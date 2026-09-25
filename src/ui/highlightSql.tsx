import type { ReactNode } from 'react'
import { maskStrings } from '../domain/sqlText'

const keywordPattern = /\b(GROUP\s+BY|ORDER\s+BY|SELECT|FROM|WHERE|JOIN|HAVING|LIMIT|AS|ON|AND|IS|NOT|NULL|ASC|DESC)\b/gi
const stringPattern = /'[^']*'|"[^"]*"/g

export function highlightSql(sql: string): ReactNode[] {
  const masked = maskStrings(sql)
  const tokens: Array<{ start: number; end: number; className: string }> = []
  for (const match of masked.matchAll(keywordPattern)) {
    tokens.push({ start: match.index, end: match.index + match[0].length, className: keywordClassName(match[1].toUpperCase().replace(/\s+/g, ' ')) })
  }
  for (const match of sql.matchAll(stringPattern)) {
    tokens.push({ start: match.index, end: match.index + match[0].length, className: 'sql-string' })
  }
  tokens.sort((left, right) => left.start - right.start)

  const parts: ReactNode[] = []
  let cursor = 0
  tokens.forEach((token, index) => {
    if (token.start < cursor) return
    if (token.start > cursor) parts.push(<span key={`t${index}`}>{sql.slice(cursor, token.start)}</span>)
    parts.push(<span key={`k${index}`} className={token.className}>{sql.slice(token.start, token.end)}</span>)
    cursor = token.end
  })
  if (cursor < sql.length) parts.push(<span key="tail">{sql.slice(cursor)}</span>)
  return parts
}

function keywordClassName(keyword: string) {
  if (keyword === 'SELECT') return 'sql-keyword sql-keyword-select'
  if (keyword === 'WHERE' || keyword === 'HAVING') return 'sql-keyword sql-keyword-filter'
  if (keyword === 'FROM' || keyword === 'JOIN' || keyword === 'ON') return 'sql-keyword sql-keyword-source'
  if (keyword === 'GROUP BY' || keyword === 'ORDER BY' || keyword === 'LIMIT') return 'sql-keyword sql-keyword-shape'
  return 'sql-keyword sql-keyword-logic'
}
