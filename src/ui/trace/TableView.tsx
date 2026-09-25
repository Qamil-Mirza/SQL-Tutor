import { useState } from 'react'
import { formatScalar } from '../../domain/engine'
import type { AliasedRow, Highlight, SortSummary } from '../../domain/types'
import { highlightSets, isSelectedColumn } from './highlightSets'

export const FULL_TABLE_ROWS = 12
export const PREVIEW_TABLE_ROWS = 8

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
  const [showAll, setShowAll] = useState(false)
  if (!rows.length) return <p className="empty">{emptyMessage}</p>

  const columns = rows[0].columns ?? [...new Set(rows.flatMap((row) => Object.keys(row.values)))]
  const sets = highlightSets(highlights)
  const summaries = new Map((sortSummaries ?? []).map((summary) => [summary.rowId, summary]))
  const expandable = rows.length > FULL_TABLE_ROWS
  const visible = expandable && !showAll ? rows.slice(0, PREVIEW_TABLE_ROWS) : rows

  return (
    <div className="trace-table">
      <div className="table-scroll">
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
            {visible.map((row) => {
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
      {expandable ? (
        <button className="show-all-link" type="button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer rows' : `Show all ${rows.length} rows`}
        </button>
      ) : null}
    </div>
  )
}

function rowClassName(rowId: string, sets: ReturnType<typeof highlightSets>) {
  if (sets.removed.has(rowId) || sets.unmatched.has(rowId)) return 'removed-row'
  if (sets.matched.has(rowId)) return 'matched-row'
  return undefined
}
