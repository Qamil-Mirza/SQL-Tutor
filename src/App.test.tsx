import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createShareUrl } from './domain/shareSnapshot'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
  vi.restoreAllMocks()
})

function renderApp(search = '') {
  window.history.replaceState({}, '', `/${search}`)
  return render(<App />)
}

async function setQuery(sql: string) {
  const editor = screen.getByRole('textbox', { name: 'SQL query' })
  await userEvent.clear(editor)
  await userEvent.type(editor, sql)
  await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
}

function stepPosition() {
  return screen.getByText(/^Step \d+ of \d+$/).textContent
}

describe('App', () => {
  it('traces the starter query on first load with the query pinned and clause highlighted', () => {
    renderApp()
    expect(screen.queryByRole('button', { name: 'Start visualizing SQL' })).not.toBeInTheDocument()
    expect(stepPosition()).toBe('Step 1 of 4')
    expect(screen.getByRole('heading', { name: 'FROM' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full SQL query')).toHaveTextContent("SELECT u.name, u.tier FROM users AS u WHERE u.tier = 'pro' LIMIT 2")
    expect(screen.getByLabelText('Full SQL query').querySelector('.active-query-clause')).toHaveTextContent('FROM users AS u')
  })

  it('moves through the timeline with buttons, pills and arrow keys', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(stepPosition()).toBe('Step 2 of 4')
    expect(screen.getByRole('heading', { name: 'WHERE' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full SQL query').querySelector('.active-query-clause')).toHaveTextContent("WHERE u.tier = 'pro'")

    await userEvent.keyboard('{ArrowRight}')
    expect(stepPosition()).toBe('Step 3 of 4')
    await userEvent.keyboard('{ArrowLeft}')
    expect(stepPosition()).toBe('Step 2 of 4')

    await userEvent.click(screen.getByRole('button', { name: '4 LIMIT' }))
    expect(stepPosition()).toBe('Step 4 of 4')
    expect(screen.getByRole('region', { name: 'Final result' })).toBeInTheDocument()
    expect(screen.getByText('Nothing trimmed: 2 rows, limit is 2.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next →' })).toBeDisabled()
  })

  it('does not move the timeline when arrow keys are pressed inside an editor', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('textbox', { name: 'SQL query' }))
    await userEvent.keyboard('{ArrowRight}')
    expect(stepPosition()).toBe('Step 1 of 4')
  })

  it('shows Before and After together for WHERE', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }))
    const before = screen.getByRole('region', { name: 'Before' })
    const after = screen.getByRole('region', { name: 'After' })
    expect(within(before).getByText('Ben').closest('tr')).toHaveClass('removed-row')
    expect(within(after).queryByText('Ben')).not.toBeInTheDocument()
    expect(screen.getByText("Kept 2 of 4 rows where u.tier = 'pro'.")).toBeInTheDocument()
  })

  it('runs a new query, resets to step 1 and shows friendly errors', async () => {
    renderApp()
    await setQuery('SELECT name FROM users ORDER BY name DESC')
    expect(stepPosition()).toBe('Step 1 of 3')
    await userEvent.click(screen.getByRole('button', { name: '3 ORDER BY' }))
    expect(within(screen.getByRole('region', { name: 'Final result' })).getAllByText(/^was #/)).not.toHaveLength(0)

    await setQuery('SELECT name FROM users LIMIT 2 ORDER BY name')
    expect(screen.getByRole('alert')).toHaveTextContent('ORDER BY must come before LIMIT.')
  })

  it('walks grouped queries one group per step and shows HAVING verdicts', async () => {
    renderApp()
    await setQuery('SELECT region, COUNT(*) AS n FROM users GROUP BY region HAVING n > 1')
    expect(stepPosition()).toBe('Step 1 of 5')
    await userEvent.click(screen.getByRole('button', { name: '3 HAVING' }))
    expect(screen.getAllByText('KEEP')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '4 SELECT' }))
    expect(screen.getByText('Collapsed group region = west (2 rows) into one result row (1 of 2).')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'After' })).getAllByRole('row')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '5 SELECT' }))
    expect(within(screen.getByRole('region', { name: 'Final result' })).getAllByRole('row')).toHaveLength(3)
  })

  it('shows a show-all link for a large cross join', async () => {
    renderApp()
    await setQuery('SELECT * FROM users, listening')
    await userEvent.click(screen.getByRole('button', { name: '2 Cross join' }))
    const after = screen.getByRole('region', { name: 'After' })
    expect(within(after).getAllByRole('row')).toHaveLength(9)
    await userEvent.click(within(after).getByRole('button', { name: 'Show all 20 rows' }))
    expect(within(after).getAllByRole('row')).toHaveLength(21)
  })

  it('keeps the Tables section collapsed when tables are valid and opens it on error', async () => {
    renderApp()
    const details = screen.getByText(/^Tables: users \(4\)/).closest('details')!
    expect(details.open).toBe(false)
    await userEvent.click(screen.getByText(/^Tables: users \(4\)/))
    const editor = screen.getByLabelText('Table SQL')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'CREATE TABLE pets (id, name);{enter}INSERT INTO pets VALUES (1);')
    await userEvent.click(screen.getByRole('button', { name: 'Apply Tables' }))
    expect(screen.getByRole('alert')).toHaveTextContent('INSERT into "pets" has 1 values but 2 columns.')
    expect(details.open).toBe(true)
  })

  it('reports an unknown table after tables change and keeps the Tables section open', async () => {
    renderApp()
    await userEvent.click(screen.getByText(/^Tables: users \(4\)/))
    const editor = screen.getByLabelText('Table SQL')
    await userEvent.clear(editor)
    await userEvent.type(editor, "CREATE TABLE pets (id, name);{enter}INSERT INTO pets VALUES (1, 'Miso');")
    await userEvent.click(screen.getByRole('button', { name: 'Apply Tables' }))
    expect(screen.getByText('Tables: pets (1)')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown table "users". Available tables: pets.')
    expect(screen.getByText('Tables: pets (1)').closest('details')!.open).toBe(true)
  })

  it('re-traces the current query with the new tables after Apply Tables', async () => {
    renderApp()
    const editor = screen.getByRole('textbox', { name: 'SQL query' })
    await userEvent.clear(editor)
    await userEvent.type(editor, 'select name from pets')
    await userEvent.click(screen.getByText(/^Tables: users \(4\)/))
    const tableEditor = screen.getByLabelText('Table SQL')
    await userEvent.clear(tableEditor)
    await userEvent.type(tableEditor, "CREATE TABLE pets (id, name);{enter}INSERT INTO pets VALUES (1, 'Miso');")
    await userEvent.click(screen.getByRole('button', { name: 'Apply Tables' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Full SQL query')).toHaveTextContent('SELECT name FROM pets')
    expect(stepPosition()).toBe('Step 1 of 2')
    expect(screen.getByText('Tables: pets (1)').closest('details')!.open).toBe(false)
  })

  it('persists the workspace and restores it on reload', async () => {
    renderApp()
    await setQuery('SELECT name FROM users')
    const saved = JSON.parse(window.localStorage.getItem('c88c-sql-tutor-workspace') ?? '{}')
    expect(saved.sql).toBe('SELECT name\n  FROM users')
    cleanup()

    window.localStorage.setItem('c88c-sql-tutor-workspace', JSON.stringify({ ...saved, sql: 'SELECT name FROM users' }))
    renderApp()
    expect(screen.getByLabelText('Full SQL query')).toHaveTextContent('SELECT name FROM users')
  })

  it('keeps working when storage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    renderApp()
    expect(screen.getByLabelText('Full SQL query')).toBeInTheDocument()
  })

  it('opens a share link as a sandbox without touching the saved workspace', async () => {
    window.localStorage.setItem('c88c-sql-tutor-workspace', JSON.stringify({ tables: [], tableSql: 'CREATE TABLE mine (a);', sql: 'SELECT a FROM mine' }))
    const url = new URL(createShareUrl({ origin: window.location.origin, snapshot: { version: 1, tableSql: "CREATE TABLE pets (id, name);\nINSERT INTO pets VALUES (1, 'Miso');", sql: 'SELECT name FROM pets' } }))
    renderApp(url.search)
    expect(screen.getByText('Tables: pets (1)')).toBeInTheDocument()
    expect(screen.getByLabelText('Full SQL query')).toHaveTextContent('SELECT name FROM pets')
    await setQuery('SELECT id FROM pets')
    expect(JSON.parse(window.localStorage.getItem('c88c-sql-tutor-workspace')!).sql).toBe('SELECT a FROM mine')
  })

  it('loads a share link whose query fails and shows the error above an empty trace', () => {
    const url = new URL(createShareUrl({ origin: window.location.origin, snapshot: { version: 1, tableSql: 'CREATE TABLE pets (id);\nINSERT INTO pets VALUES (1);', sql: 'SELECT nope FROM pets' } }))
    renderApp(url.search)
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown column "nope".')
    expect(screen.queryByText(/^Step \d+ of \d+$/)).not.toBeInTheDocument()
    expect(screen.getByText('Run a supported query to see the execution steps.')).toBeInTheDocument()
  })

  it('shows the share link immediately and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(window.navigator, { clipboard: { writeText } })
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog', { name: 'Share link' })
    expect((within(dialog).getByLabelText('Share link') as HTMLInputElement).value).toContain('share=')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalled()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Copied')
  })

  it('keeps the pinned query on the traced SQL while the editor changes and after a failed run', async () => {
    renderApp()
    const editor = screen.getByRole('textbox', { name: 'SQL query' })
    await userEvent.type(editor, ' -- note')
    expect(screen.getByLabelText('Full SQL query')).not.toHaveTextContent('-- note')
    expect(screen.getByLabelText('Full SQL query').querySelector('.active-query-clause')).toHaveTextContent('FROM users AS u')

    await setQuery('SELECT name FROM users LIMIT 2 ORDER BY name')
    expect(screen.getByRole('alert')).toHaveTextContent('ORDER BY must come before LIMIT.')
    expect(stepPosition()).toBe('Step 1 of 4')
    expect(screen.getByLabelText('Full SQL query')).toHaveTextContent("SELECT u.name, u.tier FROM users AS u WHERE u.tier = 'pro' LIMIT 2")
  })

  it('ignores arrow keys while the share dialog is open or a modifier is held', async () => {
    renderApp()
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(stepPosition()).toBe('Step 1 of 4')
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    await userEvent.keyboard('{ArrowRight}')
    expect(stepPosition()).toBe('Step 1 of 4')
  })
})
