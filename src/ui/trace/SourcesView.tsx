import type { ExecutionStep, Highlight } from '../../domain/types'
import { TableView } from './TableView'

export function SourcesView({
  sources,
  highlights,
  matchList,
}: {
  sources: NonNullable<ExecutionStep['sources']>
  highlights: Highlight[]
  matchList?: string[]
}) {
  return (
    <div className="source-grid">
      {sources.map((source) => (
        <section className="source-panel" key={source.label} aria-label={`${source.label} source rows`}>
          <h4>{source.label}</h4>
          <TableView rows={source.rows} highlights={highlights} />
        </section>
      ))}
      {matchList?.length ? (
        <ul className="match-list" aria-label="Join matches">
          {matchList.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
    </div>
  )
}
