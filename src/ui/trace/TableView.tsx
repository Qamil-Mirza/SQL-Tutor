import { formatScalar } from '../../domain/engine'
import type { AliasedRow, Highlight, SortSummary } from '../../domain/types'
import { highlightSets, isSelectedColumn } from './highlightSets'

// Tables longer than this scroll inside a fixed-height box instead of growing the page.
export const SCROLL_TABLE_ROWS = 12

export function TableView({
  rows,
  highlights = [],
  sortSummaries,
  showBadges = true,
  emptyMessage = 'No rows.',
}: {
  rows: AliasedRow[]
  highlights?: Highlight[]
  sortSummaries?: SortSummary[]
  showBadges?: boolean
  emptyMessage?: string
}) {
  if (!rows.length) return <p className="empty">{emptyMessage}</p>

  const columns = rows[0].columns ?? [...new Set(rows.flatMap((row) => Object.keys(row.values)))]
  const sets = highlightSets(highlights)
  const summaries = new Map((sortSummaries ?? []).map((summary) => [summary.rowId, summary]))
  const scrollable = rows.length > SCROLL_TABLE_ROWS

  return (
    <div className="trace-table">
      {scrollable ? <p className="table-caption">{tableCaption(rows, sets)}</p> : null}
      <div className={scrollable ? 'table-scroll is-scrollable' : 'table-scroll'}>
        <table>
          <thead>
            <tr>
              {showBadges ? <th>row</th> : null}
              {columns.map((column) => (
                <th key={column} className={isSelectedColumn(column, sets.selected) ? 'selected-column' : undefined}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const summary = summaries.get(row.id)
              const offTableKeys = summary?.keys.filter((key) => !columns.some((column) => column.toLowerCase() === key.label.toLowerCase())) ?? []
              return (
                <tr key={row.id} className={rowClassName(row.id, sets)}>
                  {showBadges ? (
                    <td>
                      <span className="alias-badge">{row.id}</span>
                      {summary && summary.beforeRank !== summary.afterRank ? <span className="rank-badge">was #{summary.beforeRank}</span> : null}
                      {offTableKeys.map((key) => (
                        <span className="key-badge" key={key.label}>{key.label} {formatScalar(key.value)}</span>
                      ))}
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column} className={isSelectedColumn(column, sets.selected) ? 'selected-column' : undefined}>{formatScalar(row.values[column])}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function tableCaption(rows: AliasedRow[], sets: ReturnType<typeof highlightSets>) {
  const count = (set: Set<string>) => rows.filter((row) => set.has(row.id)).length
  const parts = [`${rows.length} rows`]
  for (const [label, set] of [['matched', sets.matched], ['removed', sets.removed], ['unmatched', sets.unmatched]] as const) {
    const n = count(set)
    if (n) parts.push(`${n} ${label}`)
  }
  return parts.join(' · ')
}

function rowClassName(rowId: string, sets: ReturnType<typeof highlightSets>) {
  if (sets.removed.has(rowId) || sets.unmatched.has(rowId)) return 'removed-row'
  if (sets.matched.has(rowId)) return 'matched-row'
  return undefined
}
