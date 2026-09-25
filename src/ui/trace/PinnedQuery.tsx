import { findClauseRange } from './findClauseRange'

export function PinnedQuery({ sql, clause }: { sql: string; clause?: string }) {
  const range = clause ? findClauseRange(sql, clause) : undefined
  return (
    <pre className="pinned-query" aria-label="Full SQL query">
      <code>
        {range ? (
          <>
            <span>{sql.slice(0, range[0])}</span>
            <span className="active-query-clause">{sql.slice(range[0], range[1])}</span>
            <span>{sql.slice(range[1])}</span>
          </>
        ) : sql}
      </code>
    </pre>
  )
}
