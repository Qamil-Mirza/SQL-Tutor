import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { createShareUrl } from './domain/shareSnapshot'

afterEach(() => {
  window.history.pushState({}, '', '/')
  window.localStorage.clear()
})

async function advanceToQueryPage() {
  await userEvent.click(screen.getByRole('button', { name: 'Continue to Query' }))
}

describe('App', () => {
  it('starts on a focused table creation page', () => {
    render(<App />)
    expect(window.location.pathname).toBe('/tables')
    expect(screen.getByRole('heading', { name: 'Tables' })).toBeInTheDocument()
    expect(screen.getByLabelText('Table creation page')).toContainElement(screen.getByRole('heading', { name: 'Create table' }))
    expect(screen.queryByRole('heading', { name: 'Run a query' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Trace' })).not.toBeInTheDocument()
  })

  it('applies valid table SQL before navigating to the query page', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(screen.getByLabelText('Table SQL'), "CREATE TABLE pets (id, name);{enter}INSERT INTO pets VALUES (1, 'Miso');")
    await advanceToQueryPage()

    expect(window.location.pathname).toBe('/query')
    expect(screen.getByRole('heading', { name: 'Query' })).toBeInTheDocument()
    expect(screen.getByLabelText('Query page table context')).toHaveTextContent('pets')
    expect(screen.getByText('Miso')).toBeInTheDocument()
    expect(screen.queryByLabelText('Table SQL')).not.toBeInTheDocument()
  })

  it('stays on the table page when table SQL is invalid', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(screen.getByLabelText('Table SQL'), 'SELECT * FROM users')
    await advanceToQueryPage()

    expect(window.location.pathname).toBe('/tables')
    expect(screen.getByRole('alert')).toHaveTextContent('Use CREATE TABLE')
    expect(screen.queryByRole('heading', { name: 'Query' })).not.toBeInTheDocument()
  })

  it('requires valid table SQL before using workflow navigation to query', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(screen.getByLabelText('Table SQL'), 'SELECT * FROM users')
    await userEvent.click(screen.getByRole('button', { name: 'Query' }))

    expect(window.location.pathname).toBe('/tables')
    expect(screen.getByRole('alert')).toHaveTextContent('Use CREATE TABLE')
  })

  it('requires valid table SQL before using workflow navigation to trace', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(screen.getByLabelText('Table SQL'), 'SELECT * FROM users')
    await userEvent.click(screen.getByRole('button', { name: 'Trace' }))

    expect(window.location.pathname).toBe('/tables')
    expect(screen.getByRole('alert')).toHaveTextContent('Use CREATE TABLE')
    expect(screen.queryByRole('heading', { name: 'Trace' })).not.toBeInTheDocument()
  })

  it('redirects direct query route entry when saved table SQL is invalid', () => {
    window.localStorage.setItem(
      'c88c-sql-tutor-workspace',
      JSON.stringify({ tables: [], tableSql: 'SELECT * FROM users', sql: 'SELECT * FROM users' }),
    )
    window.history.pushState({}, '', '/query')

    render(<App />)

    expect(window.location.pathname).toBe('/tables')
    expect(screen.getByRole('alert')).toHaveTextContent('Use CREATE TABLE')
    expect(screen.queryByRole('heading', { name: 'Query' })).not.toBeInTheDocument()
  })

  it('redirects direct visualization route entry when saved table SQL is invalid', () => {
    window.localStorage.setItem(
      'c88c-sql-tutor-workspace',
      JSON.stringify({ tables: [], tableSql: 'SELECT * FROM users', sql: 'SELECT * FROM users' }),
    )
    window.history.pushState({}, '', '/visualization')

    render(<App />)

    expect(window.location.pathname).toBe('/tables')
    expect(screen.getByRole('alert')).toHaveTextContent('Use CREATE TABLE')
    expect(screen.queryByRole('heading', { name: 'Trace' })).not.toBeInTheDocument()
  })

  it('contains wide table previews inside the table creation page', () => {
    render(<App />)
    expect(screen.getByLabelText('Table creation page').querySelector('.table-overflow-boundary')).toBeInTheDocument()
  })

  it('runs the starter query and navigates steps', async () => {
    render(<App />)
    await advanceToQueryPage()
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    expect(window.location.pathname).toBe('/visualization')
    expect(screen.getByRole('heading', { name: 'FROM' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getByRole('heading', { name: 'WHERE' })).toBeInTheDocument()
  })

  it('renders self-join visualization', async () => {
    render(<App />)
    await advanceToQueryPage()
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT e.name AS employee, m.name AS manager FROM employees AS e JOIN employees AS m ON e.manager_id = m.id WHERE e.salary < m.salary')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    expect(window.location.pathname).toBe('/visualization')
    expect(screen.getByRole('heading', { name: 'Trace' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getAllByText(/matched/)).toHaveLength(3)
  })

  it('shows friendly errors', async () => {
    render(<App />)
    await advanceToQueryPage()
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT DISTINCT name FROM users')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    expect(window.location.pathname).toBe('/query')
    expect(screen.getByRole('alert')).toHaveTextContent('DISTINCT is not supported')
  })

  it('runs a query against user-defined table SQL', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(screen.getByLabelText('Table SQL'), "CREATE TABLE pets (id, name);{enter}INSERT INTO pets VALUES (1, 'Miso');")
    await userEvent.click(screen.getByRole('button', { name: 'Create Tables' }))
    expect(screen.getByRole('heading', { name: 'pets' })).toBeInTheDocument()
    await advanceToQueryPage()
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT p.name FROM pets AS p')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await userEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getAllByText('Miso').length).toBeGreaterThan(0)
  })

  it('runs a query against multi-row table SQL created from the table pane', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(
      screen.getByLabelText('Table SQL'),
      [
        'CREATE TABLE User_Data (',
        'User_ID TEXT PRIMARY KEY,',
        'Location TEXT,',
        'Minutes INTEGER,',
        'Top_Genre TEXT,',
        'Top_Artist TEXT',
        ');',
        'INSERT INTO User_Data VALUES',
        "('tiffany123', 'Berkeley', 2434, 'Pop', 'Olivia Rodrigo'),",
        "('aidan456', 'Oakland', 1800, 'Afrobeats', 'Burna Boy'),",
        "('colleen789', 'San Jose', 3200, 'Flamenco', 'ROSALÍA');",
      ].join('{enter}'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create Tables' }))
    expect(screen.getByRole('heading', { name: 'User_Data' })).toBeInTheDocument()
    expect(screen.getByText('ROSALÍA')).toBeInTheDocument()
    await advanceToQueryPage()

    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), "SELECT u.Top_Artist FROM User_Data AS u WHERE u.Location = 'San Jose'")
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await userEvent.click(screen.getByLabelText('Next step'))
    await userEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getAllByText('ROSALÍA').length).toBeGreaterThan(0)
  })

  it('runs a wildcard query against user-defined table SQL without a table alias', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(
      screen.getByLabelText('Table SQL'),
      "CREATE TABLE mentors (name, food, color, editor, language);{enter}INSERT INTO mentors VALUES ('Chi', 'Thai', 'Purple', 'Notepad++', 'Java');{enter}INSERT INTO mentors VALUES ('Kaitlyn', 'Pie', 'Green', 'Sublime', 'Java');",
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create Tables' }))
    await advanceToQueryPage()
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT * FROM mentors')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await userEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getAllByText('Chi').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Notepad++').length).toBeGreaterThan(0)
  })

  it('shows both loaded sources on the FROM step for comma joins', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(
      screen.getByLabelText('Table SQL'),
      "CREATE TABLE mentors (name, language);{enter}INSERT INTO mentors VALUES ('Chi', 'Java');{enter}INSERT INTO mentors VALUES ('Kaitlyn', 'Java');",
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create Tables' }))
    await advanceToQueryPage()
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT m1.name, m2.name FROM mentors AS m1, mentors AS m2 WHERE m1.name > m2.name')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))

    expect(screen.getByRole('heading', { name: 'FROM' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'mentors as m1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'mentors as m2' })).toBeInTheDocument()
    expect(screen.getAllByText('Chi').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Kaitlyn').length).toBeGreaterThanOrEqual(2)
  })

  it('does not run the query when applying table SQL', async () => {
    render(<App />)
    expect(screen.getAllByText('Ada').length).toBeGreaterThan(0)

    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(screen.getByLabelText('Table SQL'), "CREATE TABLE users (id, name, tier, region);{enter}INSERT INTO users VALUES (1, 'Grace', 'pro', 'west');")
    await userEvent.click(screen.getByRole('button', { name: 'Create Tables' }))
    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/tables')
    expect(screen.queryByRole('heading', { name: 'Trace' })).not.toBeInTheDocument()

    await advanceToQueryPage()
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    expect(screen.getAllByText('Grace').length).toBeGreaterThan(0)
  })

  it('uses Table SQL as the only table creation method', () => {
    render(<App />)
    expect(screen.getByLabelText('Table SQL')).toBeInTheDocument()
    expect(screen.queryByLabelText('Table creation method')).not.toBeInTheDocument()
    expect(screen.queryByText('Fill in a table')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('users name row 1')).not.toBeInTheDocument()
  })

  it('paginates created table previews after five rows', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(
      screen.getByLabelText('Table SQL'),
      [
        'CREATE TABLE numbers (id, label);',
        "INSERT INTO numbers VALUES (1, 'one');",
        "INSERT INTO numbers VALUES (2, 'two');",
        "INSERT INTO numbers VALUES (3, 'three');",
        "INSERT INTO numbers VALUES (4, 'four');",
        "INSERT INTO numbers VALUES (5, 'five');",
        "INSERT INTO numbers VALUES (6, 'six');",
      ].join('{enter}'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create Tables' }))
    expect(screen.getByText('one')).toBeInTheDocument()
    expect(screen.queryByText('six')).not.toBeInTheDocument()
    expect(screen.getByText('Rows 1-5 of 6')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next page for numbers' }))
    expect(screen.getByText('six')).toBeInTheDocument()
    expect(screen.queryByText('one')).not.toBeInTheDocument()
    expect(screen.getByText('Rows 6-6 of 6')).toBeInTheDocument()
  })

  it('renders readable SQL keyword highlighting', () => {
    window.history.pushState({}, '', '/query')
    render(<App />)
    expect(screen.getByText('SELECT')).toHaveClass('sql-keyword-select')
    expect(screen.getByText('WHERE')).toHaveClass('sql-keyword-filter')
  })

  it('grows the SQL query editor for longer queries', async () => {
    render(<App />)
    await advanceToQueryPage()
    const editor = screen.getByLabelText('SQL query editor')
    expect(editor).toHaveAttribute('rows', '6')

    await userEvent.clear(editor)
    await userEvent.type(
      editor,
      [
        'SELECT u.name, u.tier, u.region, l.artist, l.minutes',
        'FROM users AS u',
        'JOIN listening AS l ON u.id = l.user_id',
        "WHERE u.tier = 'pro'",
        'ORDER BY l.minutes DESC',
        'LIMIT 10',
      ].join('{enter}'),
    )

    expect(editor).toHaveAttribute('rows', '7')
  })

  it('colors selected columns green on the SELECT step', async () => {
    render(<App />)
    await advanceToQueryPage()
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await userEvent.click(screen.getByLabelText('Next step'))
    await userEvent.click(screen.getByLabelText('Next step'))
    const selectedHeaders = screen.getAllByRole('columnheader').filter((header) => header.classList.contains('selected-column'))
    expect(selectedHeaders.map((header) => header.textContent)).toEqual(expect.arrayContaining(['u.name', 'u.tier']))
  })

  it('shows aggregate values on grouped query steps', async () => {
    render(<App />)
    await advanceToQueryPage()
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(
      screen.getByLabelText('SQL query editor'),
      'SELECT u.tier, COUNT(*) AS plays, SUM(l.minutes) AS minutes FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await userEvent.click(screen.getByLabelText('Next step'))
    await userEvent.click(screen.getByLabelText('Next step'))

    expect(screen.getByRole('heading', { name: 'GROUP BY' })).toBeInTheDocument()
    expect(screen.getAllByText('COUNT(*) = 3').length).toBeGreaterThan(0)
    expect(screen.getAllByText('SUM(l.minutes) = 165').length).toBeGreaterThan(0)
  })

  it('marks groups removed by HAVING', async () => {
    render(<App />)
    await advanceToQueryPage()
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(
      screen.getByLabelText('SQL query editor'),
      'SELECT u.tier, COUNT(*) AS plays, SUM(l.minutes) AS minutes FROM users AS u JOIN listening AS l ON u.id = l.user_id GROUP BY u.tier HAVING SUM(l.minutes) > 80',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await userEvent.click(screen.getByLabelText('Next step'))
    await userEvent.click(screen.getByLabelText('Next step'))
    await userEvent.click(screen.getByLabelText('Next step'))

    expect(screen.getByRole('heading', { name: 'HAVING' })).toBeInTheDocument()
    expect(screen.getByText('SUM(l.minutes) > 80 -> false')).toBeInTheDocument()
    expect(screen.getByLabelText('Group free')).toHaveClass('removed-group')
  })

  it('shows sort keys and rank movement on ORDER BY steps', async () => {
    render(<App />)
    await advanceToQueryPage()
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT u.name, u.tier FROM users AS u ORDER BY u.name DESC')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await userEvent.click(screen.getByLabelText('Next step'))
    await userEvent.click(screen.getByLabelText('Next step'))

    expect(screen.getByRole('heading', { name: 'ORDER BY' })).toBeInTheDocument()
    expect(screen.getByText('u.name DESC = Dina')).toBeInTheDocument()
    expect(screen.getByText('4 -> 1')).toBeInTheDocument()
  })

  it('shows the visualization page as a focused route with a back action', async () => {
    render(<App />)
    await advanceToQueryPage()
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    expect(window.location.pathname).toBe('/visualization')
    expect(screen.getByRole('heading', { name: 'Trace' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tables' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back to query' }))
    expect(window.location.pathname).toBe('/query')
    expect(screen.getByRole('heading', { name: 'Query' })).toBeInTheDocument()
  })

  it('opens a shared link directly on the trace page', () => {
    const shareUrl = createShareUrl({
      origin: window.location.origin,
      snapshot: {
        version: 1,
        tableSql: "CREATE TABLE pets (id, name);\nINSERT INTO pets VALUES (1, 'Miso');",
        sql: 'SELECT p.name FROM pets AS p',
      },
    })
    window.history.pushState({}, '', new URL(shareUrl).pathname + new URL(shareUrl).search)

    render(<App />)

    expect(window.location.pathname).toBe('/visualization')
    expect(screen.getByRole('heading', { name: 'Trace' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'FROM' })).toBeInTheDocument()
    expect(screen.getAllByText('Miso').length).toBeGreaterThan(0)
  })

  it('keeps the original shared link immutable when a viewer edits locally', async () => {
    const shareUrl = createShareUrl({
      origin: window.location.origin,
      snapshot: {
        version: 1,
        tableSql: "CREATE TABLE pets (id, name);\nINSERT INTO pets VALUES (1, 'Miso');",
        sql: 'SELECT p.name FROM pets AS p',
      },
    })
    const sharedLocation = new URL(shareUrl)
    window.history.pushState({}, '', sharedLocation.pathname + sharedLocation.search)

    const { unmount } = render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Back to query' }))
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT p.id FROM pets AS p')
    expect(screen.getByLabelText('SQL query editor')).toHaveValue('SELECT p.id FROM pets AS p')

    unmount()
    window.history.pushState({}, '', sharedLocation.pathname + sharedLocation.search)
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Back to query' }))
    expect(screen.getByLabelText('SQL query editor')).toHaveValue('SELECT p.name FROM pets AS p')
  })

  it('generates a visible share link for the current workspace', async () => {
    const { unmount } = render(<App />)
    await advanceToQueryPage()
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))

    const shareLink = screen.getByLabelText('Share link')
    expect((shareLink as HTMLInputElement).value).toContain('/visualization?share=')

    const sharedLocation = new URL((shareLink as HTMLInputElement).value)
    unmount()
    window.history.pushState({}, '', sharedLocation.pathname + sharedLocation.search)
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Trace' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'FROM' })).toBeInTheDocument()
  })
})
