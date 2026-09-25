import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { executeQuery } from '../../domain/engine'
import { parseQuery } from '../../domain/parser'
import { initialTables } from '../../domain/samples'
import { StepPanel } from './StepPanel'
import { findClauseRange } from './findClauseRange'

function stepsFor(sql: string) {
  return executeQuery(parseQuery(sql), initialTables)
}

describe('StepPanel', () => {
  it('shows Before and After side by side for WHERE with faded rows on the left', () => {
    const [, where] = stepsFor("SELECT name FROM users WHERE tier = 'pro'")
    render(<StepPanel step={where} isLast={false} />)
    expect(screen.getByRole('heading', { name: 'WHERE' })).toBeInTheDocument()
    expect(screen.getByText("Kept 2 of 4 rows where tier = 'pro'.")).toBeInTheDocument()
    const before = screen.getByRole('region', { name: 'Before' })
    const after = screen.getByRole('region', { name: 'After' })
    expect(within(before).getByText('Ben').closest('tr')).toHaveClass('removed-row')
    expect(within(after).queryByText('Ben')).not.toBeInTheDocument()
  })

  it('labels the last step After panel as Final result', () => {
    const steps = stepsFor('SELECT name FROM users')
    render(<StepPanel step={steps.at(-1)!} isLast />)
    expect(screen.getByRole('region', { name: 'Final result' })).toBeInTheDocument()
  })

  it('shows sources, key columns and the match list for JOIN', () => {
    const [, join] = stepsFor('SELECT u.name FROM users AS u JOIN listening AS l ON u.id = l.user_id')
    render(<StepPanel step={join} isLast={false} />)
    const before = screen.getByRole('region', { name: 'Before' })
    expect(within(before).getByLabelText('users (as u) source rows')).toBeInTheDocument()
    expect(within(before).getByLabelText('Join matches')).toHaveTextContent('u1 ↔ l1, l2')
    expect(within(before).getAllByRole('columnheader').filter((cell) => cell.classList.contains('selected-column')).map((cell) => cell.textContent)).toEqual(['u.id', 'l.user_id'])
  })

  it('renders group cards with verdicts for HAVING and one group per selectGroup step', () => {
    const steps = stepsFor('SELECT region, COUNT(*) AS n FROM users GROUP BY region HAVING n > 5')
    const having = steps.find((step) => step.kind === 'having')!
    render(<StepPanel step={having} isLast={false} />)
    expect(screen.getAllByText('REJECT')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'After' })).toHaveTextContent('No groups remain.')
  })

  it('says no groups remain before an empty grouped SELECT and highlights selected columns after', () => {
    const empty = stepsFor('SELECT region, COUNT(*) AS n FROM users GROUP BY region HAVING n > 5').find((step) => step.kind === 'select')!
    const { unmount } = render(<StepPanel step={empty} isLast />)
    expect(screen.getByRole('region', { name: 'Before' })).toHaveTextContent('No groups remain.')
    unmount()

    const select = stepsFor('SELECT name FROM users').find((step) => step.kind === 'select')!
    render(<StepPanel step={select} isLast />)
    const after = screen.getByRole('region', { name: 'Final result' })
    expect(within(after).getAllByRole('columnheader').filter((cell) => cell.classList.contains('selected-column')).map((cell) => cell.textContent)).toEqual(['name'])
  })

  it('finds clause ranges tolerant of whitespace and case', () => {
    expect(findClauseRange('SELECT a\n  FROM t\n WHERE a = 1', 'from t')).toEqual([11, 17])
    expect(findClauseRange('SELECT a FROM t', 'LIMIT 2')).toBeUndefined()
  })
})
