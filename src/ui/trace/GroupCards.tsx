import type { ReactNode } from 'react'
import type { Group, Highlight } from '../../domain/types'
import { TableView } from './TableView'

export function GroupCards({
  groups,
  highlights = [],
  removedGroupIds,
  renderSummary,
}: {
  groups: Group[]
  highlights?: Highlight[]
  removedGroupIds?: Set<string>
  renderSummary?: (group: Group) => ReactNode
}) {
  if (!groups.length) return <p className="empty">No groups remain.</p>
  return (
    <div className="group-tables">
      {groups.map((group) => (
        <section className={removedGroupIds?.has(group.id) ? 'group-card removed-card' : 'group-card'} key={group.id} aria-label={`Group ${group.key}`}>
          <header className="group-card-title">
            <span className="band-key">{group.key}</span>
            {renderSummary ? renderSummary(group) : null}
          </header>
          <TableView rows={group.rows} highlights={highlights} />
        </section>
      ))}
    </div>
  )
}
