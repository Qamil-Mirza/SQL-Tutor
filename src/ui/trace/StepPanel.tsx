import type { ReactNode } from 'react'
import { formatScalar } from '../../domain/engine'
import type { AliasedRow, ExecutionStep, Group } from '../../domain/types'
import { GroupCards } from './GroupCards'
import { highlightSets } from './highlightSets'
import { SourcesView } from './SourcesView'
import { TableView } from './TableView'

export function StepPanel({ step, isLast }: { step: ExecutionStep; isLast: boolean }) {
  const afterLabel = isLast ? 'Final result' : step.kind === 'from' ? 'Loaded rows' : 'After'
  const before = renderBefore(step)
  return (
    <article className="step-panel">
      <p className="eyebrow">Step</p>
      <h2>{step.title}</h2>
      <p className="step-summary">{step.summary}</p>
      <div className={before ? 'step-states two-up' : 'step-states'}>
        {before ? (
          <section className="step-state" aria-label="Before">
            <h3>Before</h3>
            {before}
          </section>
        ) : null}
        <section className="step-state" aria-label={afterLabel}>
          <h3>{afterLabel}</h3>
          {renderAfter(step)}
        </section>
      </div>
    </article>
  )
}

function renderBefore(step: ExecutionStep): ReactNode {
  switch (step.kind) {
    case 'from':
      return null
    case 'join':
      return <SourcesView sources={step.sources ?? []} highlights={step.highlights} />
    case 'having':
      return (
        <GroupCards
          groups={step.before as Group[]}
          removedGroupIds={highlightSets(step.highlights).removedGroups}
          renderSummary={(group) => <HavingVerdict group={group} />}
        />
      )
    case 'selectGroup':
      return <GroupCards groups={step.before as Group[]} highlights={step.highlights} />
    case 'select':
      return (
        <TableView
          rows={(step.before ?? []) as AliasedRow[]}
          highlights={step.highlights}
          emptyMessage={step.summary.startsWith('No groups') ? 'No groups remain.' : 'No rows.'}
        />
      )
    default:
      return <TableView rows={(step.before ?? []) as AliasedRow[]} highlights={step.highlights} emptyMessage="No rows." />
  }
}

function renderAfter(step: ExecutionStep): ReactNode {
  switch (step.kind) {
    case 'from':
      return <SourcesView sources={step.sources ?? []} highlights={step.highlights} />
    case 'groupBy':
      return <GroupCards groups={step.after as Group[]} highlights={step.highlights} />
    case 'having':
      return <GroupCards groups={step.after as Group[]} />
    case 'orderBy':
      return <TableView rows={step.after as AliasedRow[]} highlights={step.highlights} sortSummaries={step.sortSummaries} />
    case 'join':
      return <TableView rows={step.after as AliasedRow[]} highlights={step.highlights.filter((highlight) => highlight.kind === 'selected')} emptyMessage="No rows matched." />
    default:
      return <TableView rows={step.after as AliasedRow[]} highlights={step.highlights.filter((highlight) => highlight.kind === 'matched' || highlight.kind === 'selected')} emptyMessage="No rows remain." />
  }
}

// Shows each tested aggregate's computed value and the KEEP / REJECT verdict.
function HavingVerdict({ group }: { group: Group }) {
  const conditions = group.conditions ?? []
  const kept = conditions.every((condition) => condition.result)
  return (
    <span className="band-verdict-line">
      {conditions.map((condition) => (
        <span className="band-actual" key={condition.label}>{condition.leftLabel} = {formatScalar(condition.value)}</span>
      ))}
      <span className={kept ? 'band-verdict band-verdict-keep' : 'band-verdict band-verdict-reject'}>{kept ? 'KEEP' : 'REJECT'}</span>
    </span>
  )
}
