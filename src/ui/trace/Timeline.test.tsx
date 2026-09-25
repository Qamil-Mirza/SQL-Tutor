import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeQuery } from '../../domain/engine'
import { parseQuery } from '../../domain/parser'
import { initialTables } from '../../domain/samples'
import { Timeline } from './Timeline'

describe('Timeline', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never scrolls the page when mounting or changing step', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const steps = executeQuery(parseQuery("SELECT name FROM users WHERE tier = 'pro'"), initialTables)
    expect(steps).toHaveLength(3)

    const { rerender } = render(<Timeline steps={steps} stepIndex={0} onChange={() => {}} />)
    rerender(<Timeline steps={steps} stepIndex={2} onChange={() => {}} />)
    rerender(<Timeline steps={steps} stepIndex={1} onChange={() => {}} />)

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })
})
