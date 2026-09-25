import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QueryEditor } from './QueryEditor'

describe('QueryEditor', () => {
  it('runs on Cmd/Ctrl+Enter without inserting a newline', async () => {
    const onRun = vi.fn()
    const onSqlChange = vi.fn()
    render(<QueryEditor sql="SELECT 1" onSqlChange={onSqlChange} onFormat={() => {}} onRun={onRun} onShare={() => {}} />)
    await userEvent.click(screen.getByRole('textbox', { name: 'SQL query' }))
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onSqlChange).not.toHaveBeenCalled()
  })
})
