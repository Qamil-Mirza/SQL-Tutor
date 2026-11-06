import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { highlightSql } from './highlightSql'

describe('highlightSql', () => {
  it('colours keywords outside strings and marks strings', () => {
    const { container } = render(<pre>{highlightSql("select name from t where a = 'from'")}</pre>)
    const keywords = [...container.querySelectorAll('.sql-keyword')].map((node) => node.textContent)
    expect(keywords).toEqual(['select', 'from', 'where'])
    expect(container.querySelector('.sql-string')?.textContent).toBe("'from'")
  })

  it('colours LIKE and NOT LIKE', () => {
    const { container } = render(<pre>{highlightSql("where a not like 'x%' and b like 'y'")}</pre>)
    const keywords = [...container.querySelectorAll('.sql-keyword')].map((node) => node.textContent)
    expect(keywords).toEqual(['where', 'not', 'like', 'and', 'like'])
  })
})
