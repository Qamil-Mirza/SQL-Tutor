import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import Root from './Root'
import { createShareUrl } from './domain/shareSnapshot'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
})

function renderAt(path: string) {
  window.history.replaceState({}, '', path)
  return render(<Root />)
}

describe('Root', () => {
  it('shows the landing page at the root path', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1, name: 'SQL Visualizer' })).toBeInTheDocument()
    expect(screen.getByText(/DATA C88C class understand how SQL manipulates tables/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Qamil Mirza' })).toHaveAttribute('href', 'https://qamil-mirza.com')
    expect(screen.getByText(/Not affiliated with UC Berkeley or DATA C88C/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Explore/ })).toHaveAttribute('href', '/explore')
    expect(screen.queryByRole('link', { name: /Feedback/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'SQL query' })).not.toBeInTheDocument()
  })

  it('opens the visualizer from Explore and returns to the landing page on back', async () => {
    renderAt('/')
    await userEvent.click(screen.getByRole('link', { name: /Explore/ }))
    expect(window.location.pathname).toBe('/explore')
    expect(screen.getByRole('textbox', { name: 'SQL query' })).toBeInTheDocument()

    act(() => {
      window.history.replaceState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByRole('heading', { level: 1, name: 'SQL Visualizer' })).toBeInTheDocument()
  })

  it('shows the visualizer directly at /explore', () => {
    renderAt('/explore')
    expect(screen.getByRole('textbox', { name: 'SQL query' })).toBeInTheDocument()
  })

  it('skips the landing page for share links on the root path', () => {
    const shareUrl = new URL(createShareUrl({ origin: 'https://example.com', snapshot: { version: 1, tableSql: 'CREATE TABLE t (a); INSERT INTO t VALUES (1);', sql: 'SELECT a FROM t' } }))
    renderAt(`/${shareUrl.search}`)
    expect((screen.getByRole('textbox', { name: 'SQL query' }) as HTMLTextAreaElement).value).toMatch(/^SELECT a\s+FROM t$/)
  })

  it('lets visitors step through the demo query in logical order', async () => {
    renderAt('/')
    const demo = screen.getByRole('figure', { name: 'How a query runs' })
    expect(demo).toHaveTextContent('Start with every row in users.')
    await userEvent.click(screen.getByRole('button', { name: /WHERE tier = 'pro'/ }))
    expect(demo).toHaveTextContent("Keep only rows where tier is 'pro'.")
    await userEvent.click(screen.getByRole('button', { name: /SELECT name, tier/ }))
    expect(demo).toHaveTextContent('Keep only the columns you asked for.')
  })
})
