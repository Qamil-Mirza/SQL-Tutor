import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AliasedRow } from '../../domain/types'
import { TableView } from './TableView'

function rows(n: number): AliasedRow[] {
  return Array.from({ length: n }, (_, index) => ({ id: `t${index + 1}`, values: { id: index + 1, name: `row ${index + 1}` } }))
}

describe('TableView', () => {
  it('renders small tables without a scroll box or caption', () => {
    const { container } = render(<TableView rows={rows(12)} />)
    expect(screen.getAllByRole('row')).toHaveLength(13)
    expect(container.querySelector('.is-scrollable')).toBeNull()
    expect(screen.queryByText(/12 rows/)).not.toBeInTheDocument()
  })

  it('renders every row of a large table in a scroll box with a count caption', () => {
    const { container } = render(<TableView rows={rows(20)} highlights={[{ kind: 'removed', rowIds: ['t3', 't17', 't20'] }]} />)
    expect(screen.getAllByRole('row')).toHaveLength(21)
    expect(container.querySelector('.table-scroll.is-scrollable')).not.toBeNull()
    expect(screen.getByText('20 rows · 3 removed')).toBeInTheDocument()
  })

  it('uses the columns list for order and highlights rows and columns', () => {
    const data: AliasedRow[] = [
      { id: '#1', values: { b: 2, a: 1 }, columns: ['b', 'a'] },
      { id: '#2', values: { b: 4, a: 3 }, columns: ['b', 'a'] },
    ]
    render(
      <TableView
        rows={data}
        highlights={[{ kind: 'removed', rowIds: ['#2'] }, { kind: 'selected', columnKeys: ['u.a'] }]}
      />,
    )
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['row', 'b', 'a'])
    expect(screen.getAllByRole('columnheader')[2]).toHaveClass('selected-column')
    expect(screen.getByText('#2').closest('tr')).toHaveClass('removed-row')
  })

  it('shows rank badges and off-table sort keys from sort summaries', () => {
    const data: AliasedRow[] = [
      { id: '#3', values: { name: 'Chen' }, columns: ['name'] },
      { id: '#1', values: { name: 'Ada' }, columns: ['name'] },
    ]
    render(
      <TableView
        rows={data}
        sortSummaries={[
          { rowId: '#3', beforeRank: 3, afterRank: 1, keys: [{ label: 'height', value: 52, direction: 'DESC' }] },
          { rowId: '#1', beforeRank: 1, afterRank: 2, keys: [{ label: 'height', value: 26, direction: 'DESC' }] },
        ]}
      />,
    )
    const first = screen.getAllByRole('row')[1]
    expect(within(first).getByText('was #3')).toBeInTheDocument()
    expect(within(first).getByText('height 52')).toBeInTheDocument()
  })

  it('renders an empty message', () => {
    render(<TableView rows={[]} emptyMessage="No rows remain." />)
    expect(screen.getByText('No rows remain.')).toBeInTheDocument()
  })
})
