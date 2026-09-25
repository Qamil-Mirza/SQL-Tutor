import type { ExecutionStep, Highlight } from '../../domain/types'
import { TableView } from './TableView'

export function SourcesView({
  sources,
  highlights,
}: {
  sources: NonNullable<ExecutionStep['sources']>
  highlights: Highlight[]
}) {
  return (
    <div className="source-grid">
      {sources.map((source) => (
        <section className="source-panel" key={source.label} aria-label={`${source.label} source rows`}>
          <h4>{source.label}</h4>
          <TableView rows={source.rows} highlights={highlights} />
        </section>
      ))}
    </div>
  )
}
