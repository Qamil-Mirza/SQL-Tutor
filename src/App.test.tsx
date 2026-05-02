import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import appCss from './App.css?raw'

describe('App', () => {
  it('presents a focused build and trace workspace', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Tables and query' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Trace' })).toBeInTheDocument()
    expect(screen.queryByText('Starter query ready')).not.toBeInTheDocument()
  })

  it('keeps the query editor directly after table setup in the build pane', () => {
    expect(appCss).not.toMatch(/\.query-card\s*{\s*margin-top:\s*auto;\s*}/)
  })

  it('runs the starter query and navigates steps', async () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'FROM' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getByRole('heading', { name: 'WHERE' })).toBeInTheDocument()
  })

  it('renders self-join visualization', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT e.name AS employee, m.name AS manager FROM employees AS e JOIN employees AS m ON e.manager_id = m.id WHERE e.salary < m.salary')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    expect(screen.getByLabelText('SQL query editor')).toHaveValue('SELECT e.name AS employee, m.name AS manager FROM employees AS e JOIN employees AS m ON e.manager_id = m.id WHERE e.salary < m.salary')
    await userEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getAllByText(/matched/)).toHaveLength(3)
  })

  it('shows friendly errors', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT DISTINCT name FROM users')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    expect(screen.getByRole('alert')).toHaveTextContent('DISTINCT is not supported')
  })

  it('runs a query against user-defined table SQL', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(screen.getByLabelText('Table SQL'), "CREATE TABLE pets (id, name);{enter}INSERT INTO pets VALUES (1, 'Miso');")
    await userEvent.click(screen.getByRole('button', { name: 'Apply Table SQL' }))
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT p.name FROM pets AS p')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await userEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getAllByText('Miso').length).toBeGreaterThan(0)
  })

  it('runs a wildcard query against user-defined table SQL without a table alias', async () => {
    render(<App />)
    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(
      screen.getByLabelText('Table SQL'),
      "CREATE TABLE mentors (name, food, color, editor, language);{enter}INSERT INTO mentors VALUES ('Chi', 'Thai', 'Purple', 'Notepad++', 'Java');{enter}INSERT INTO mentors VALUES ('Kaitlyn', 'Pie', 'Green', 'Sublime', 'Java');",
    )
    await userEvent.click(screen.getByRole('button', { name: 'Apply Table SQL' }))
    await userEvent.clear(screen.getByLabelText('SQL query editor'))
    await userEvent.type(screen.getByLabelText('SQL query editor'), 'SELECT * FROM mentors')
    await userEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await userEvent.click(screen.getByLabelText('Next step'))
    expect(screen.getAllByText('Chi').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Notepad++').length).toBeGreaterThan(0)
  })

  it('does not run the query when applying table SQL', async () => {
    render(<App />)
    expect(screen.getAllByText('Ada').length).toBeGreaterThan(0)

    await userEvent.clear(screen.getByLabelText('Table SQL'))
    await userEvent.type(screen.getByLabelText('Table SQL'), "CREATE TABLE users (id, name, tier, region);{enter}INSERT INTO users VALUES (1, 'Grace', 'pro', 'west');")
    await userEvent.click(screen.getByRole('button', { name: 'Apply Table SQL' }))
    expect(screen.queryByText('Grace')).not.toBeInTheDocument()
    expect(screen.getAllByText('Ada').length).toBeGreaterThan(0)

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
})
