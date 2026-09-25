import type { Highlight } from '../../domain/types'

export function highlightSets(highlights: Highlight[] = []) {
  const collect = (kind: Highlight['kind'], field: 'rowIds' | 'columnKeys' | 'groupIds') =>
    new Set(highlights.filter((highlight) => highlight.kind === kind).flatMap((highlight) => highlight[field] ?? []))
  return {
    removed: collect('removed', 'rowIds'),
    unmatched: collect('unmatched', 'rowIds'),
    matched: collect('matched', 'rowIds'),
    selected: new Set([...collect('selected', 'columnKeys')].map((key) => key.toLowerCase())),
    removedGroups: collect('removed', 'groupIds'),
  }
}

export function isSelectedColumn(column: string, selected: Set<string>) {
  const lower = column.toLowerCase()
  const bare = lower.includes('.') ? lower.slice(lower.indexOf('.') + 1) : lower
  return selected.has(lower) || selected.has(bare) || [...selected].some((key) => key.includes('.') && key.slice(key.indexOf('.') + 1) === bare && !lower.includes('.'))
}
